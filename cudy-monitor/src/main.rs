use std::{collections::{HashMap,VecDeque},fs,io::{Read,Write},net::{TcpListener,TcpStream},process::Command,sync::{mpsc::{sync_channel,TrySendError},Arc,Mutex},thread,time::{Duration,Instant}};
const PAGE:&str=include_str!("../web/index.html");
static SERVICE_BUSY:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
#[derive(Clone,Default)] struct Cpu { total:u64,idle:u64 }
#[derive(Clone,Default)] struct Net { rx:u64,tx:u64 }
#[derive(Clone)] struct Sample {sec:u64,cpu:f64,ram:f64,temp:Option<f64>}
#[derive(Clone)] struct NetSample {sec:u64,rx:f64,tx:f64}
const NETWORK_POINTS:usize=150; // last five minutes at two-second intervals
const HISTORY_POINTS:usize=1080; // 3 hours at one sample per 10 seconds
#[derive(Clone)]
struct ServiceAction {id:u64,name:String,verb:String,state:String,detail:String}
struct State {service_action:Option<ServiceAction>,cpu:Cpu,core_ticks:Vec<(usize,Cpu)>,current_cores:Vec<(usize,f64)>,events:VecDeque<(u64,String)>,high_cpu:bool,high_ram:bool,pid_ticks:HashMap<u64,u64>,pid_usage:HashMap<u64,f64>,nets:HashMap<String,Net>,last:Instant,history_at:Instant,boot:Instant,history:VecDeque<Sample>,net_histories:HashMap<String,VecDeque<NetSample>>,current_cpu:f64,current_network:Vec<(String,f64,f64)>}
fn read(p:&str)->String {fs::read_to_string(p).unwrap_or_default()}
fn platform()->&'static str {
    if std::path::Path::new("/etc/openwrt_release").exists() || read("/etc/os-release").contains("OpenWrt") {"OpenWrt"}
    else if read("/etc/os-release").contains("Keenetic") {"KeeneticOS"}
    else {"Linux / Entware"}
}
fn device_model()->String {
    for path in ["/tmp/sysinfo/model","/proc/device-tree/model","/sys/firmware/devicetree/base/model"] {
        let value=read(path);
        let model=value.trim_matches(|c:char|c=='\0'||c.is_whitespace());
        if !model.is_empty(){return model.chars().take(120).collect();}
    }
    "ARM64 router".into()
}
fn valid_iface(name:&str)->bool{
    !name.is_empty() && name.len()<=32 &&
    name.bytes().all(|b|b.is_ascii_alphanumeric() || matches!(b,b'-'|b'_'|b'.'|b'@'))
}
// /proc/net/route represents the main IPv4 table. This is NOT a proof of Internet reachability
// or policy-routing correctness. Equal-priority routes across different devices are ambiguous.
fn default_wan_from_routes(source:&str)->(Option<String>,&'static str){
    let mut best:Option<(u64,String)>=None;
    let mut ambiguous=false;
    for line in source.lines().skip(1){
        let fields:Vec<_>=line.split_whitespace().collect();
        if fields.len()<8 {continue;}
        let iface=fields[0];
        if !valid_iface(iface)||iface=="lo" || fields[1]!="00000000" || fields[7]!="00000000" {continue;}
        let flags=match u32::from_str_radix(fields[3],16){Ok(v)=>v,Err(_)=>continue};
        if flags&1==0 || flags&0x200!=0 {continue;} // must be UP; ignore REJECT
        let metric=match fields[6].parse::<u64>(){Ok(v)=>v,Err(_)=>continue};
        match &best{
            None=>{best=Some((metric,iface.into()));ambiguous=false;}
            Some((old,_)) if metric<*old=>{best=Some((metric,iface.into()));ambiguous=false;}
            Some((old,name)) if metric==*old && name!=iface=>ambiguous=true,
            _=>{}
        }
    }
    match best{
        None=>(None,"missing"),
        Some(_) if ambiguous=>(None,"ambiguous"),
        Some((_,iface))=>(Some(iface),"main_ipv4_route")
    }
}
fn default_wan()->(Option<String>,&'static str){
    default_wan_from_routes(&read("/proc/net/route"))
}
fn num(s:&str)->u64{s.trim().parse().unwrap_or(0)}
fn quoted(s:&str)->String {let mut v=String::from("\"");for c in s.chars(){match c {'"'=>v.push_str("\\\""),'\\'=>v.push_str("\\\\"),'\n'=>v.push_str("\\n"),'\r'=>v.push_str("\\r"),'\t'=>v.push_str("\\t"),c if c.is_control()=>{},c=>v.push(c)}}v.push('"');v}
fn cpu()->Cpu {let line=read("/proc/stat");let vals:Vec<u64>=line.lines().next().unwrap_or("").split_whitespace().skip(1).take(10).map(num).collect();Cpu{total:vals.iter().sum(),idle:vals.get(3).copied().unwrap_or(0)+vals.get(4).copied().unwrap_or(0)}}
fn nets()->HashMap<String,Net>{let mut m=HashMap::new();for l in read("/proc/net/dev").lines().skip(2){if let Some((name,rest))=l.split_once(':'){let a:Vec<_>=rest.split_whitespace().collect();if a.len()>8 && name.trim()!="lo"{m.insert(name.trim().to_string(),Net{rx:num(a[0]),tx:num(a[8])});}}}m}
fn mem_kib(source:&str,key:&str)->Option<u64>{
    source.lines().find(|line|line.starts_with(key))
        .and_then(|line|line.split_whitespace().nth(1))
        .and_then(|value|value.parse::<u64>().ok())
}
fn htop_used_kib(source:&str)->Option<u64>{
    let total=mem_kib(source,"MemTotal:")?;
    let free=mem_kib(source,"MemFree:")?;
    let buffers=mem_kib(source,"Buffers:")?;
    let cached=mem_kib(source,"Cached:")?;
    let reclaimable=mem_kib(source,"SReclaimable:")?;
    let shared=mem_kib(source,"Shmem:")?;
    Some(total.saturating_sub(free).saturating_sub(buffers)
        .saturating_sub(cached).saturating_sub(reclaimable).saturating_add(shared).min(total))
}
fn mem_detail()->(u64,u64,u64,Option<f64>,Option<f64>){
    let source=read("/proc/meminfo");
    let total=mem_kib(&source,"MemTotal:").unwrap_or(0);
    let available=mem_kib(&source,"MemAvailable:");
    let used=available.map(|v|total.saturating_sub(v)).unwrap_or(0);
    (total/1024,used/1024,mem_kib(&source,"Cached:").unwrap_or(0)/1024,
        htop_used_kib(&source).map(|v|v as f64/1024.0),available.map(|v|v as f64/1024.0))
}
fn mem()->(u64,u64,u64){let (total,used,cached,_,_)=mem_detail();(total,used,cached)}

fn disk()->(u64,u64,String){if std::env::var("CUDY_MONITOR_NATIVE_APK").ok().as_deref()==Some("1") { if let Ok(o)=Command::new("df").args(["-Pk","/overlay"]).output(){if o.status.success(){if let Some(l)=String::from_utf8_lossy(&o.stdout).lines().last(){let a:Vec<_>=l.split_whitespace().collect();if a.len()>=6{return (num(a[1])/1024,num(a[2])/1024,"/overlay".into())}}}} return (0,0,"/overlay unavailable".into());} if fs::metadata("/opt/etc").is_err(){return (0,0,"/opt not mounted".into());}for path in ["/opt"]{if let Ok(o)=Command::new("df").args(["-Pk",path]).output(){if o.status.success(){if let Some(l)=String::from_utf8_lossy(&o.stdout).lines().last(){let a:Vec<_>=l.split_whitespace().collect();if a.len()>=6{return (num(a[1])/1024,num(a[2])/1024,path.to_string())}}}}}(0,0,"unknown".into())}
fn temps()->Vec<(String,f64)>{let mut out=Vec::new();if let Ok(entries)=fs::read_dir("/sys/class/thermal"){for e in entries.flatten(){let p=e.path();if !e.file_name().to_string_lossy().starts_with("thermal_zone"){continue}let t=read(&p.join("temp").to_string_lossy()).trim().parse::<f64>().unwrap_or(-1.);if !(0.0..=150000.).contains(&t){continue}let n=read(&p.join("type").to_string_lossy());out.push((n.trim().to_string(),if t>1000.{t/1000.}else{t}));}}out.truncate(12);out}
fn procs()->Vec<(String,u64,u64)>{let mut p=Vec::new();if let Ok(it)=fs::read_dir("/proc"){for e in it.flatten(){let id=e.file_name().to_string_lossy().to_string();if !id.bytes().all(|x|x.is_ascii_digit()){continue}let n=read(&format!("/proc/{id}/comm"));if n.is_empty(){continue}let status=read(&format!("/proc/{id}/status"));let kb=status.lines().find(|l|l.starts_with("VmRSS:")).and_then(|l|l.split_whitespace().nth(1)).map(num).unwrap_or(0);p.push((n.trim().to_string(),num(&id),kb/1024));}}p.sort_by(|a,b|b.2.cmp(&a.2));p.truncate(32);p}
fn pid_ticks()->HashMap<u64,u64>{
 let mut out=HashMap::new();
 if let Ok(entries)=fs::read_dir("/proc"){for e in entries.flatten(){
  let name=e.file_name().to_string_lossy().to_string();
  if let Ok(pid)=name.parse::<u64>(){
   let stat=read(&format!("/proc/{pid}/stat"));
   if let Some((_,tail))=stat.rsplit_once(')'){
    let values:Vec<_>=tail.split_whitespace().collect();
    if values.len()>12 {out.insert(pid,num(values[11])+num(values[12]));}
   }
  }
 }}
 out
}
fn cpu_percent(dt:u64,di:u64)->f64{if dt==0{0.0}else{(100.0*dt.saturating_sub(di) as f64/dt as f64).clamp(0.0,100.0)}}
fn sample(state:&Arc<Mutex<State>>){
    let now=Instant::now();
    let nc=cpu();
    let ticks=core_ticks();
    let pid_now=pid_ticks();
    let nn=nets();
    let mut s=state.lock().unwrap_or_else(|e|e.into_inner());
    let dt=nc.total.saturating_sub(s.cpu.total);
    let di=nc.idle.saturating_sub(s.cpu.idle);
    let secs=now.duration_since(s.last).as_secs_f64().max(0.2);
    s.current_cpu=cpu_percent(dt,di);
    s.pid_usage=pid_now.iter().map(|(pid,total)|{
        let delta=s.pid_ticks.get(pid).map(|old|total.saturating_sub(*old)).unwrap_or(0);
        (*pid,if dt>0{(100.0*delta as f64/dt as f64).min(100.0)}else{0.0})
    }).collect();
    s.pid_ticks=pid_now;
    s.current_cores=ticks.iter().map(|(idx,t)|{let v=s.core_ticks.iter().find(|(i,_)|i==idx).map(|(_,old)|cpu_percent(t.total.saturating_sub(old.total),t.idle.saturating_sub(old.idle))).unwrap_or(0.0);(*idx,v)}).collect();
    s.core_ticks=ticks;
    s.current_network=nn.iter().map(|(name,v)|{
        let previous=s.nets.get(name);
        let rx=previous.map(|o|v.rx.saturating_sub(o.rx) as f64/secs).unwrap_or(0.);
        let tx=previous.map(|o|v.tx.saturating_sub(o.tx) as f64/secs).unwrap_or(0.);
        (name.clone(),rx,tx)
    }).collect();
    if now.duration_since(s.history_at)>=Duration::from_secs(10) {
        // Read sensors only once per stored point; nothing is written to USB.
        let (total,used,_)=mem();
        let ram=if total>0 {100.0*used as f64/total as f64}else{0.0};
        let temp=temps().first().map(|(_,v)|*v);
        let point=Sample{sec:now.duration_since(s.boot).as_secs(),cpu:s.current_cpu,ram,temp};
        if s.history.len()==HISTORY_POINTS{s.history.pop_front();}
        s.history.push_back(point);
        s.history_at=now;
    }
    // Operational events are bounded and kept in RAM, never on USB.
    let (total,used,_)=mem();
    let ram_pct=if total>0{100.0*used as f64/total as f64}else{0.0};
    let cpu_hot=s.current_cpu>=90.0;
    let ram_hot=ram_pct>=90.0;
    let mut notes=Vec::new();
    if cpu_hot!=s.high_cpu {notes.push(if cpu_hot{"Высокая нагрузка CPU"}else{"Нагрузка CPU восстановилась"});}
    if ram_hot!=s.high_ram {notes.push(if ram_hot{"Высокое использование RAM"}else{"Использование RAM восстановилось"});}
    s.high_cpu=cpu_hot;s.high_ram=ram_hot;
    let event_sec=now.duration_since(s.boot).as_secs();for note in notes {if s.events.len()>=80{s.events.pop_front();}s.events.push_back((event_sec,note.to_string()));}
    // Auto-discover OpenWrt/Keenetic network devices with bounded RAM use.
    let mut available=s.current_network.clone();
    available.sort_by(|a,b|{
        let rank=|v:&str| if v=="eth2.4"||v=="wan"||v=="pppoe-wan"{0}
            else if v=="br-lan"||v=="br0"{1}
            else if v.starts_with("wlan")||v.starts_with("ra"){2}else{3};
        rank(&a.0).cmp(&rank(&b.0))
            .then_with(||(b.1+b.2).total_cmp(&(a.1+a.2)))
    });
    let tracked:Vec<_>=available.into_iter().filter(|x|valid_iface(&x.0))
        .take(16).collect();
    let allowed:std::collections::HashSet<_>=tracked.iter().map(|x|x.0.clone()).collect();
    s.net_histories.retain(|k,_|allowed.contains(k));
    let traffic_sec=now.duration_since(s.boot).as_secs();
    for (name,rx,tx) in tracked{
        let list=s.net_histories.entry(name).or_insert_with(||VecDeque::with_capacity(NETWORK_POINTS));
        if list.len()==NETWORK_POINTS{list.pop_front();}
        list.push_back(NetSample{sec:traffic_sec,rx,tx});
    }
    // HashMap iteration order changes between polls; keep interface order stable.
    s.current_network.sort_by(|a,b|a.0.cmp(&b.0));
    s.cpu=nc;s.nets=nn;s.last=now;
}
fn history_json(state:&Arc<Mutex<State>>)->String {
    let points={let s=state.lock().unwrap_or_else(|e|e.into_inner());s.history.iter().cloned().collect::<Vec<_>>()};
    let mut out=String::with_capacity(points.len()*56+40);
    out.push_str("{\"interval_sec\":10,\"max_points\":1080,\"points\":[");
    for (i,p) in points.iter().enumerate(){
        if i>0 {out.push(',');}
        let t=p.temp.map(|t|format!("{t:.1}")).unwrap_or_else(||"null".into());
        out.push_str(&format!("[{},{:.1},{:.1},{}]",p.sec,p.cpu,p.ram,t));
    }
    out.push_str("]}");
    out
}
fn network_history_json(state:&Arc<Mutex<State>>,iface:&str)->String{
    let points={let s=state.lock().unwrap_or_else(|e|e.into_inner());s.net_histories.get(iface).map(|x|x.iter().cloned().collect::<Vec<_>>()).unwrap_or_default()};
    let mut out=format!("{{\"interface\":{},\"interval_sec\":2,\"max_points\":150,\"points\":[",quoted(iface));
    for (i,p) in points.iter().enumerate(){
        if i>0{out.push(',');}
        out.push_str(&format!("[{},{:.0},{:.0}]",p.sec,p.rx,p.tx));
    }
    out.push_str("]}");out
}
fn core_ticks()->Vec<(usize,Cpu)>{
    let text=read("/proc/stat");let mut out=Vec::new();
    for line in text.lines(){
        let mut it=line.split_whitespace();let key=it.next().unwrap_or("");
        if let Some(index)=key.strip_prefix("cpu").and_then(|x|x.parse::<usize>().ok()){
            let v:Vec<u64>=it.take(10).map(num).collect();
            let total=v.iter().sum();let idle=v.get(3).copied().unwrap_or(0)+v.get(4).copied().unwrap_or(0);
            out.push((index,Cpu{total,idle}));
        }
    }
    out.truncate(16);out
}
fn cpu_clock_mhz()->u64{
 for path in ["/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq","/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_cur_freq"]{
  let khz=num(&read(path));if khz>0{return khz/1000;}
 }
 0
}
fn connections()->(u64,u64){
    (num(&read("/proc/sys/net/netfilter/nf_conntrack_count")),num(&read("/proc/sys/net/netfilter/nf_conntrack_max")))
}
fn logs_json(state:&Arc<Mutex<State>>)->String{
    let events={let s=state.lock().unwrap_or_else(|e|e.into_inner());s.events.iter().cloned().collect::<Vec<_>>()};
    let mut out=String::from("{\"source\":\"monitor\",\"max_events\":80,\"events\":[");
    for (i,(sec,msg)) in events.iter().rev().enumerate(){
        if i>0{out.push(',');}
        out.push_str(&format!("[{},{}]",sec,quoted(msg)));
    }
    out.push_str("]}");out
}
fn own_rss_mb()->f64{
    read("/proc/self/status").lines()
        .find(|l|l.starts_with("VmRSS:"))
        .and_then(|l|l.split_whitespace().nth(1))
        .map(num).unwrap_or(0) as f64 / 1024.0
}
fn service_pids(name:&str)->Vec<u32>{
    let expected=match name{"D2K"=>"d2kd","DoQ"=>"doqd",_=>return Vec::new()};
    let mut pids=Vec::new();
    if let Ok(entries)=fs::read_dir("/proc"){
        for entry in entries.flatten(){
            let id=entry.file_name().to_string_lossy().to_string();
            if let Ok(pid)=id.parse::<u32>(){
                if read(&format!("/proc/{pid}/comm")).trim()==expected{pids.push(pid);}
            }
        }
    }
    pids.sort_unstable();pids
}
fn service_running(name:&str)->bool{!service_pids(name).is_empty()}
fn service_restarted(before:&[u32],after:&[u32])->bool{
    !after.is_empty() && (before.is_empty() ||
        (before.iter().all(|old|!after.contains(old)) &&
         after.iter().any(|new|!before.contains(new))))
}
fn service_action_json(state:&Arc<Mutex<State>>)->String{
    let a={state.lock().unwrap_or_else(|e|e.into_inner()).service_action.clone()};
    match a {
        None=>"{\"action\":null}".to_string(),
        Some(v)=>format!("{{\"action\":{{\"id\":{},\"name\":{},\"verb\":{},\"state\":{},\"detail\":{}}}}}",
            v.id,quoted(&v.name),quoted(&v.verb),quoted(&v.state),quoted(&v.detail))
    }
}
fn service_actions_enabled()->bool{
    if std::env::var("CUDY_MONITOR_NATIVE_APK").ok().as_deref()==Some("1") {return false}
    std::env::var("CUDY_MONITOR_SERVICE_ACTIONS").ok().as_deref()==Some("1")
        || read("/opt/etc/cudy-monitor/service-actions").trim()=="1"
}
fn data(s:&Arc<Mutex<State>>)->String{let (cpu,network,core_load,pid_load)={let state=s.lock().unwrap_or_else(|e|e.into_inner());(state.current_cpu,state.current_network.clone(),state.current_cores.clone(),state.pid_usage.clone())};let (mt,mu,mc,htop_used,available)=mem_detail();let htop_json=htop_used.map(|v|v.to_string()).unwrap_or_else(||"null".into());let available_json=available.map(|v|v.to_string()).unwrap_or_else(||"null".into());let (dt,du,dm)=disk();let (wan_iface,wan_route_status)=default_wan();let wan_json=wan_iface.as_deref().map(quoted).unwrap_or_else(||"null".into());let (connections,connections_max)=connections();let cpu_mhz=cpu_clock_mhz();let service_actions=service_actions_enabled();let up=read("/proc/uptime").split_whitespace().next().and_then(|x|x.parse::<f64>().ok()).unwrap_or(0.)as u64;let mut o=format!("{{\"model\":{},\"platform\":{},\"cpu\":{cpu:.1},\"mem_total\":{mt},\"mem_used\":{mu},\"mem_cached\":{mc},\"mem_htop_used\":{htop_json},\"mem_available\":{available_json},\"disk_total\":{dt},\"disk_used\":{du},\"disk_mount\":{},\"uptime\":{up},\"wan_iface\":{wan_json},\"wan_route_status\":{},\"temps\":[",quoted(&device_model()),quoted(platform()),quoted(&dm),quoted(wan_route_status));for (i,(n,c))in temps().iter().enumerate(){if i>0{o.push(',')}o.push_str(&format!("{{\"name\":{},\"c\":{c:.1}}}",quoted(n)))}o.push_str("],\"network\":[");for(i,(n,rx,tx))in network.iter().enumerate(){if i>0{o.push(',')}o.push_str(&format!("{{\"name\":{},\"rx\":{rx:.0},\"tx\":{tx:.0}}}",quoted(n)))}o.push_str("],\"cores\":[");for(i,(idx,percent))in core_load.iter().enumerate(){if i>0{o.push(',')}o.push_str(&format!("{{\"id\":{},\"usage\":{:.1}}}",idx,percent))}o.push_str("],\"processes\":[");for(i,(n,pid,rss))in procs().iter().enumerate(){if i>0{o.push(',')}o.push_str(&format!("{{\"name\":{},\"pid\":{pid},\"mem\":{rss},\"cpu\":{:.1}}}",quoted(n),pid_load.get(pid).copied().unwrap_or(0.0)))}o.push_str("],\"services\":[");for(i,n)in["D2K","DoQ","KeenKit"].iter().enumerate(){if i>0{o.push(',')}let found=if *n=="KeenKit"{false}else{service_running(n)};let installed=match *n {"KeenKit"=>std::path::Path::new("/opt/bin/keenkit").exists(),"D2K"=>std::path::Path::new("/opt/etc/init.d/S99d2k").exists(),"DoQ"=>std::path::Path::new("/opt/etc/init.d/S56doqd").exists(),_=>false};o.push_str(&format!("{{\"name\":{},\"detected\":{found},\"installed\":{installed}}}",quoted(n)))}o.push_str(&format!("],\"connections\":{},\"connections_max\":{},\"cpu_mhz\":{},\"service_actions_enabled\":{},\"monitor_rss_mb\":{:.2},\"version\":{}}}",connections,connections_max,cpu_mhz,service_actions,own_rss_mb(),quoted(env!("CARGO_PKG_VERSION"))));o}
fn respond(s:&mut TcpStream,status:&str,typ:&str,body:&[u8]){let header=format!("HTTP/1.1 {status}\r\nContent-Type: {typ}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n",body.len());let _=s.write_all(header.as_bytes());let _=s.write_all(body);}
fn constant_time_match(a:&[u8],b:&[u8])->bool{let mut diff=a.len()^b.len();for i in 0..a.len().max(b.len()){diff|=usize::from(a.get(i).copied().unwrap_or(0)^b.get(i).copied().unwrap_or(0));}diff==0}
fn update_command(mode:&str)->Result<String,String>{
    if std::env::var("CUDY_MONITOR_NATIVE_APK").ok().as_deref()==Some("1") {
        return Err("Native OpenWrt APK: update using apk package manager".into());
    }
    let script=std::env::var("CUDY_MONITOR_UPDATER").unwrap_or_else(|_|"/opt/share/cudy-monitor/update.sh".into());
    if script!= "/opt/share/cudy-monitor/update.sh" && !cfg!(debug_assertions) {
        return Err("Updater path override forbidden in release builds".into());
    }
    if !std::path::Path::new(&script).is_file(){return Err("Updater is not installed".into());}
    let output=Command::new("/bin/sh").arg(&script).arg(mode).output().map_err(|e|e.to_string())?;
    if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).trim().chars().take(250).collect());}
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
fn authorized(req:&str,token:&str)->bool{
    let candidate=req.lines().find_map(|l|l.split_once(':')
        .filter(|(k,_)|k.eq_ignore_ascii_case("X-Monitor-Token"))
        .map(|(_,v)|v.trim())).unwrap_or("");
    constant_time_match(candidate.as_bytes(),token.as_bytes())
}
fn addr_for_host(c:&TcpStream)->String { c.local_addr().map(|a|a.to_string()).unwrap_or_default() }
// Collect HTTP headers across TCP reads: a single read is not guaranteed to
// contain the entire request line and headers. Never process partial headers.
fn read_headers(c:&mut TcpStream)->std::io::Result<Option<String>> {
    const MAX_HEADERS:usize=8192;
    let mut buf=Vec::with_capacity(1024);
    let mut chunk=[0u8;1024];
    loop {
        let n=c.read(&mut chunk)?;
        if n==0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end)=buf.windows(4).position(|w|w==b"\r\n\r\n") {
            if end+4>MAX_HEADERS { return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,"request headers too large")); }
            // Do not interpret a partial/invalid header as an authenticated request.
            let request=&buf[..end+4];
            if request.contains(&0) { return Ok(None); }
            return Ok(String::from_utf8(request.to_vec()).ok());
        }
        if buf.len()>=MAX_HEADERS { return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,"request headers too large")); }
    }
}
fn semver_tuple(value:&str)->Option<(u64,u64,u64)> {
    let mut parts=value.split('.');
    let parse=|p:Option<&str>|->Option<u64> {
        let v=p?;
        if v.is_empty() || !v.bytes().all(|c|c.is_ascii_digit()) { return None; }
        v.parse::<u64>().ok()
    };
    let version=(parse(parts.next())?,parse(parts.next())?,parse(parts.next())?);
    if parts.next().is_some() { return None; }
    Some(version)
}
fn update_available(latest:&str,current:&str)->Option<bool> {
    Some(semver_tuple(latest)? > semver_tuple(current)?)
}
fn handle(mut c:TcpStream,s:Arc<Mutex<State>>,token:String){
    // LAN clients can view without a token; remote/WAN clients are always denied.
    let peer_ok=c.peer_addr().map(|p|p.ip().is_loopback() || match p.ip(){std::net::IpAddr::V4(v)=>v.is_private(),std::net::IpAddr::V6(_)=>false}).unwrap_or(false);
    if !peer_ok {respond(&mut c,"403 Forbidden","text/plain",b"LAN only");return;}
    let _=c.set_read_timeout(Some(Duration::from_secs(3)));
    let _=c.set_write_timeout(Some(Duration::from_secs(5)));
    let request=match read_headers(&mut c) {
        Ok(Some(request))=>request,
        Ok(None)=>{respond(&mut c,"400 Bad Request","text/plain",b"Malformed request");return;},
        Err(e) if e.kind()==std::io::ErrorKind::InvalidData=>{
            respond(&mut c,"431 Request Header Fields Too Large","text/plain",b"Headers too large");return;
        }
        Err(_)=>return,
    };
    let line=request.lines().next().unwrap_or("");
    if line.starts_with("GET / HTTP/") || line.starts_with("GET /index.html HTTP/") {
        respond(&mut c,"200 OK","text/html; charset=utf-8",PAGE.as_bytes());return;
    }
    if line.starts_with("GET /health HTTP/") {
        respond(&mut c,"200 OK","text/plain",b"ok");return;
    }
    if !token.is_empty() && !authorized(&request,&token){
        respond(&mut c,"401 Unauthorized","application/json",b"{\"error\":\"unauthorized\"}");return;
    }
    if line.starts_with("GET /api/service/action-status HTTP/"){
        let body=service_action_json(&s);
        respond(&mut c,"200 OK","application/json",body.as_bytes());return;
    }
    if line.starts_with("GET /api/logs HTTP/"){
        let body=logs_json(&s);respond(&mut c,"200 OK","application/json",body.as_bytes());return;
    }
    if line.starts_with("GET /api/network-history HTTP/") || line.starts_with("GET /api/network-history?iface="){
        let iface=line.split_whitespace().nth(1).unwrap_or("").strip_prefix("/api/network-history?iface=").unwrap_or("eth2.4");
        if !valid_iface(iface) || !(matches!(iface,"eth2.4"|"br0"|"ra9"|"ra1") || nets().contains_key(iface)){respond(&mut c,"400 Bad Request","application/json",b"{\"error\":\"unsupported interface\"}");return;}
        let body=network_history_json(&s,iface);
        respond(&mut c,"200 OK","application/json",body.as_bytes());return;
    }
    if line.starts_with("GET /api/history HTTP/"){
        let body=history_json(&s);
        respond(&mut c,"200 OK","application/json",body.as_bytes());return;
    }
    if line.starts_with("GET /api/status HTTP/"){
        let body=data(&s);
        respond(&mut c,"200 OK","application/json",body.as_bytes());return;
    }
    if line.starts_with("GET /api/update/check HTTP/"){
        match update_command("--check"){
            Ok(data)=>{
                let parts:Vec<_>=data.split_whitespace().collect();
                let available=if parts.len()==2 {
                    update_available(parts[0],parts[1])
                } else {None};
                let Some(available)=available else {
                    respond(&mut c,"502 Bad Gateway","application/json",b"{\"error\":\"invalid update metadata\"}");return;
                };
                let body=format!("{{\"latest\":{},\"current\":{},\"available\":{}}}",
                    quoted(parts[0]),quoted(parts[1]),available);
                respond(&mut c,"200 OK","application/json",body.as_bytes());
            }
            Err(e)=>{
                let body=format!("{{\"error\":{}}}",quoted(&e));
                respond(&mut c,"503 Service Unavailable","application/json",body.as_bytes());
            }
        }
        return;
    }
    // Service actions are strictly allowlisted and disabled unless opted in on the router.
    if line.starts_with("POST /api/service/"){
        if !service_actions_enabled() {
            respond(&mut c,"403 Forbidden","application/json",b"{\"error\":\"service control disabled\"}");return;
        }
        let target=match line {
            "POST /api/service/d2k/start HTTP/1.1" => Some(("D2K","/opt/etc/init.d/S99d2k","start")),
            "POST /api/service/d2k/stop HTTP/1.1" => Some(("D2K","/opt/etc/init.d/S99d2k","stop")),
            "POST /api/service/d2k/restart HTTP/1.1" => Some(("D2K","/opt/etc/init.d/S99d2k","restart")),
            "POST /api/service/doq/start HTTP/1.1" => Some(("DoQ","/opt/etc/init.d/S56doqd","start")),
            "POST /api/service/doq/stop HTTP/1.1" => Some(("DoQ","/opt/etc/init.d/S56doqd","stop")),
            "POST /api/service/doq/restart HTTP/1.1" => Some(("DoQ","/opt/etc/init.d/S56doqd","restart")),
            _ => None,
        };
        let Some((name,script,action))=target else{
            respond(&mut c,"404 Not Found","application/json",b"{\"error\":\"unsupported service action\"}");return;
        };
        let header=|key:&str|->String{request.lines().find_map(|l|l.split_once(':').filter(|(k,_)|k.eq_ignore_ascii_case(key)).map(|(_,v)|v.trim().to_string())).unwrap_or_default()};
        let host=header("Host");let origin=header("Origin");
        if host!=addr_for_host(&c) || origin!=format!("http://{host}") || header("X-Monitor-Action")!=action{
            respond(&mut c,"403 Forbidden","application/json",b"{\"error\":\"same-origin confirmation required\"}");return;
        }
        if !std::path::Path::new(script).is_file(){
            respond(&mut c,"503 Service Unavailable","application/json",b"{\"error\":\"service script not found\"}");return;
        }
        // A single outstanding action prevents simultaneous network/DNS disruptions.
        if SERVICE_BUSY.swap(true,std::sync::atomic::Ordering::SeqCst){
            respond(&mut c,"409 Conflict","application/json",b"{\"error\":\"another action is running\"}");return;
        }
        // DoQ is the active resolver (LAN:5354). Never leave it off
        // permanently through a tokenless LAN panel: schedule an independent,
        // best-effort auto-start BEFORE invoking the stop script.
        if name=="DoQ" && action=="stop" {
            let watchdog=Command::new("/bin/sh")
                .arg("-c").arg("sleep 90; /opt/etc/init.d/S56doqd start")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null()).spawn();
            if watchdog.is_err() {
                SERVICE_BUSY.store(false,std::sync::atomic::Ordering::SeqCst);
                respond(&mut c,"503 Service Unavailable","application/json",b"{\"error\":\"DNS recovery watchdog could not start\"}");return;
            }
        }
        let before_pids=service_pids(name);
        let action_id={
            let mut st=s.lock().unwrap_or_else(|e|e.into_inner());
            let id=st.boot.elapsed().as_millis() as u64;
            st.service_action=Some(ServiceAction{id,name:name.into(),verb:action.into(),
                state:"running".into(),detail:"Команда отправлена".into()});id
        };
        let state=Arc::clone(&s);
        thread::spawn(move||{
            let mut timed_out=false;
            let mut exit_ok=false;
            let mut problem=String::new();
            match Command::new(script).arg(action)
                .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null()).spawn(){
                Ok(mut child)=>{
                    let deadline=Instant::now()+Duration::from_secs(15);
                    loop {
                        match child.try_wait(){
                            Ok(Some(status))=>{exit_ok=status.success();break;}
                            Ok(None) if Instant::now()<deadline=>thread::sleep(Duration::from_millis(200)),
                            Ok(None)=>{
                                timed_out=true;let _=child.kill();let _=child.wait();break;
                            }
                            Err(err)=>{problem=err.to_string();let _=child.kill();let _=child.wait();break;}
                        }
                    }
                }
                Err(err)=>problem=err.to_string()
            }
            // Confirm state separately from init script exit code, allowing
            // a few seconds for daemons to initialize or disappear.
            let expected=action!="stop";
            let mut after_pids=service_pids(name);
            let mut running=!after_pids.is_empty();
            let mut restarted=action!="restart"||service_restarted(&before_pids,&after_pids);
            if exit_ok {
                for _ in 0..12 {
                    if running==expected && restarted {break;}
                    thread::sleep(Duration::from_millis(400));
                    after_pids=service_pids(name);
                    running=!after_pids.is_empty();
                    restarted=action!="restart"||service_restarted(&before_pids,&after_pids);
                }
            }
            let verified=exit_ok && running==expected && restarted;
            let detail=if verified{
                format!("{name}: состояние подтверждено ({})",if running{"работает"}else{"остановлен"})
            }else if timed_out{
                format!("{name}: превышено 15 секунд; состояние не подтверждено")
            }else if !exit_ok {
                format!("{name}: команда завершилась ошибкой {}",problem.chars().take(80).collect::<String>())
            }else if action=="restart" && !restarted {
                format!("{name}: перезапуск не подтверждён — PID процесса не изменился")
            }else{
                format!("{name}: команда выполнена, но процесс не перешёл в ожидаемое состояние")
            };
            {
                let mut st=state.lock().unwrap_or_else(|e|e.into_inner());
                if let Some(a)=st.service_action.as_mut(){
                    if a.id==action_id {
                        a.state=if verified{"verified"}else{"failed"}.into();
                        a.detail=detail.clone();
                    }
                }
                let elapsed=st.boot.elapsed().as_secs();
                if st.events.len()>=80{st.events.pop_front();}
                st.events.push_back((elapsed,detail));
            }
            SERVICE_BUSY.store(false,std::sync::atomic::Ordering::SeqCst);
        });
        respond(&mut c,"202 Accepted","application/json",if name=="DoQ" && action=="stop"{&b"{\"status\":\"started\",\"auto_restore_sec\":90}"[..]}else{&b"{\"status\":\"started\"}"[..]});return;
    }
    if line.starts_with("POST /api/update/apply HTTP/"){
        if std::env::var("CUDY_MONITOR_NATIVE_APK").ok().as_deref()==Some("1") {
            respond(&mut c,"503 Service Unavailable","application/json",b"{\"error\":\"use native OpenWrt apk upgrade\"}");return;
        }
        // Require a custom header and local host Origin to limit cross-site requests.
        let host=request.lines().find_map(|l|l.split_once(':')
            .filter(|(k,_)|k.eq_ignore_ascii_case("Host")).map(|(_,v)|v.trim())).unwrap_or("");
        let origin=request.lines().find_map(|l|l.split_once(':')
            .filter(|(k,_)|k.eq_ignore_ascii_case("Origin")).map(|(_,v)|v.trim())).unwrap_or("");
        let action_header=request.lines().find_map(|l|l.split_once(':')
            .filter(|(k,_)|k.eq_ignore_ascii_case("X-Monitor-Action")).map(|(_,v)|v.trim())).unwrap_or("");
        if action_header!="apply" || origin.is_empty() || origin!=format!("http://{host}") || host != addr_for_host(&c) {
            respond(&mut c,"403 Forbidden","application/json",b"{\"error\":\"origin mismatch\"}");return;
        }
        let script="/opt/share/cudy-monitor/update.sh";
        if !std::path::Path::new(script).is_file(){
            respond(&mut c,"503 Service Unavailable","application/json",b"{\"error\":\"updater not installed\"}");return;
        }
        // Detached updater survives a restart of this web daemon.
        match Command::new("/bin/sh").arg("-c")
            .arg("sleep 2; exec /bin/sh /opt/share/cudy-monitor/update.sh --apply >/dev/null 2>&1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null()).spawn(){
            Ok(_)=>respond(&mut c,"202 Accepted","application/json",b"{\"status\":\"started\"}"),
            Err(_)=>respond(&mut c,"500 Internal Server Error","application/json",b"{\"error\":\"could not start updater\"}"),
        };
        return;
    }
    respond(&mut c,"404 Not Found","text/plain",b"Not found");
}
fn main()->std::io::Result<()>{
    if std::env::args().nth(1).as_deref()==Some("--version"){
        println!("cudy-monitor-pro {}",env!("CARGO_PKG_VERSION"));return Ok(());
    }
    let addr=std::env::var("CUDY_MONITOR_BIND").unwrap_or_else(|_|"127.0.0.1:8237".into());
    let token=String::new(); // LAN-only, no login token required.
    let bind_ip:std::net::IpAddr=addr.rsplit_once(':').and_then(|(ip,_)|ip.parse().ok())
        .ok_or_else(||std::io::Error::new(std::io::ErrorKind::InvalidInput,"Invalid bind address"))?;
    if !(bind_ip.is_loopback() || match bind_ip {std::net::IpAddr::V4(v)=>v.is_private() && !v.is_unspecified(),std::net::IpAddr::V6(_)=>false}) {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied,"Monitor must bind to a specific LAN or loopback address"));
    }
    let start=Instant::now();
    let state=Arc::new(Mutex::new(State{service_action:None,cpu:cpu(),core_ticks:core_ticks(),current_cores:Vec::new(),events:VecDeque::from([(0,String::from("Монитор запущен; история находится в RAM"))]),high_cpu:false,high_ram:false,pid_ticks:HashMap::new(),pid_usage:HashMap::new(),nets:nets(),last:start,history_at:start,boot:start,history:VecDeque::with_capacity(HISTORY_POINTS),net_histories:HashMap::new(),current_cpu:0.,current_network:Vec::new()}));
    let sampler=Arc::clone(&state);
    thread::spawn(move || loop {thread::sleep(Duration::from_secs(2));sample(&sampler);});
    let listener=TcpListener::bind(&addr)?;
    // A fixed number of workers avoids unbounded thread and memory growth.
    let (tx,rx)=sync_channel::<TcpStream>(16);
    let rx=Arc::new(Mutex::new(rx));
    for _ in 0..4 {
        let state=Arc::clone(&state);
        let rx=Arc::clone(&rx);
        let token=token.clone();
        thread::spawn(move||loop {
            let stream=match rx.lock().unwrap_or_else(|e|e.into_inner()).recv(){Ok(s)=>s,Err(_)=>break};
            handle(stream,Arc::clone(&state),token.clone());
        });
    }
    println!("Cudy Monitor Pro listening at {addr}");
    for incoming in listener.incoming(){
        if let Ok(mut stream)=incoming {
            match tx.try_send(stream){
                Ok(())=>{},
                Err(TrySendError::Full(mut conn))=>{
                    respond(&mut conn,"503 Service Unavailable","text/plain",b"Busy");
                },
                Err(TrySendError::Disconnected(_))=>break,
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn wan_main_route_prefers_lowest_metric(){
        let table="Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n\
br-lan 0002A8C0 00000000 0001 0 0 0 00FFFFFF 0 0 0\n\
eth2.4 00000000 0100000A 0003 0 0 100 00000000 0 0 0\n\
pppoe-wan 00000000 00000000 0001 0 0 10 00000000 0 0 0\n";
        assert_eq!(default_wan_from_routes(table),(Some("pppoe-wan".into()),"main_ipv4_route"));
    }
    #[test] fn wan_route_ambiguous_or_unavailable(){
        let header="Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n";
        assert_eq!(default_wan_from_routes(header),(None,"missing"));
        assert_eq!(default_wan_from_routes(&(header.to_owned()+
            "wan0 00000000 00000000 0001 0 0 10 00000000 0 0 0\n"+
            "wan1 00000000 00000000 0001 0 0 10 00000000 0 0 0\n")),(None,"ambiguous"));
        assert_eq!(default_wan_from_routes(&(header.to_owned()+
            "wan0 00000000 00000000 0000 0 0 1 00000000 0 0 0\n"+
            "wan1 00000000 00000000 0201 0 0 1 00000000 0 0 0\n")),(None,"missing"));
        assert_eq!(default_wan_from_routes(&(header.to_owned()+
            "wan0 00000000 00000000 0001 0 0 1 FFFFFFFF 0 0 0\n")),(None,"missing"));
        assert_eq!(default_wan_from_routes(&(header.to_owned()+
            "../unsafe 00000000 00000000 0001 0 0 1 00000000 0 0 0\n")),(None,"missing"));
    }
    #[test] fn ram_htop_vs_available_fixture(){
        let fixture="MemTotal: 239564 kB\nMemFree: 50632 kB\nMemAvailable: 73540 kB\nBuffers: 17960 kB\nCached: 51872 kB\nShmem: 3084 kB\nSReclaimable: 10868 kB\n";
        assert_eq!(htop_used_kib(fixture),Some(111316));
        assert_eq!(mem_kib(fixture,"MemAvailable:"),Some(73540));
        assert_eq!(mem_kib(fixture,"MemTotal:").unwrap()-mem_kib(fixture,"MemAvailable:").unwrap(),166024);
        assert_eq!(htop_used_kib("MemTotal: 239564 kB\n"),None);
    }
    #[test] fn ram_underflow_is_clamped(){
        let source="MemTotal: 100 kB\nMemFree: 90 kB\nBuffers: 40 kB\nCached: 40 kB\nSReclaimable: 40 kB\nShmem: 0 kB\n";
        assert_eq!(htop_used_kib(source),Some(0));
    }
    #[test] fn history_size(){let mut v=VecDeque::with_capacity(HISTORY_POINTS);for i in 0..3000 {if v.len()==HISTORY_POINTS{v.pop_front();}v.push_back(i)}assert_eq!(v.len(),1080);assert_eq!(v.front(),Some(&1920));}
    #[test] fn restart_identity(){assert!(service_restarted(&[12],&[13]));assert!(service_restarted(&[],&[13]));assert!(!service_restarted(&[12],&[12]));assert!(!service_restarted(&[12],&[]));assert!(!service_restarted(&[12,13],&[13,14]));}
    #[test] fn iface_validation(){assert!(valid_iface("br-lan"));assert!(valid_iface("pppoe-wan"));assert!(valid_iface("wlan0"));assert!(valid_iface("eth0.2"));assert!(!valid_iface("../etc/passwd"));assert!(!valid_iface("bad?iface"));assert!(!valid_iface(""));}
    #[test] fn cpu_math(){assert_eq!(cpu_percent(0,0),0.0);assert_eq!(cpu_percent(100,20),80.0);assert_eq!(cpu_percent(10,100),0.0);}
    #[test] fn json_quote(){assert_eq!(quoted("a\"b"),"\"a\\\"b\"");assert_eq!(quoted("test\n"),"\"test\\n\"");}
    #[test] fn token_match(){assert!(constant_time_match(b"abc",b"abc"));assert!(!constant_time_match(b"abc",b"abd"));assert!(!constant_time_match(b"abc",b"abc0"));}
    #[test] fn semver_update_detection(){
        assert_eq!(update_available("1.0.3","1.0.2"),Some(true));
        assert_eq!(update_available("1.0.3","1.0.3"),Some(false));
        assert_eq!(update_available("1.0.2","1.0.3"),Some(false));
        assert_eq!(update_available("1.10.0","1.9.9"),Some(true));
        assert_eq!(update_available("2.0.0","1.99.99"),Some(true));
        assert_eq!(update_available("1.0.0","2.0.0"),Some(false));
        for invalid in ["unknown","1.0","1.0.3-beta","1..2","1.2.3.4","","1.2.x"] {
            assert_eq!(update_available(invalid,"1.0.0"),None);
            assert_eq!(update_available("1.0.3",invalid),None);
        }
    }
    #[test] fn split_http_headers(){
        use std::net::TcpListener;
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();
        let addr=listener.local_addr().unwrap();
        let sender=std::thread::spawn(move||{
            let mut c=TcpStream::connect(addr).unwrap();
            c.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n").unwrap();
            std::thread::sleep(Duration::from_millis(25));
            c.write_all(b"Origin: http://127.0.0.1\r\n\r\n").unwrap();
        });
        let (mut stream,_)=listener.accept().unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let headers=read_headers(&mut stream).unwrap().unwrap();
        assert!(headers.contains("Host: 127.0.0.1"));
        assert!(headers.ends_with("\r\n\r\n"));
        sender.join().unwrap();
    }
    #[test] fn reject_too_large_or_incomplete_headers(){
        use std::net::TcpListener;
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();
        let addr=listener.local_addr().unwrap();
        let sender=std::thread::spawn(move||{
            let mut c=TcpStream::connect(addr).unwrap();
            c.write_all(&vec![b'x';9000]).unwrap();
        });
        let (mut stream,_)=listener.accept().unwrap();
        assert_eq!(read_headers(&mut stream).unwrap_err().kind(),std::io::ErrorKind::InvalidData);
        sender.join().unwrap();
    }
}
