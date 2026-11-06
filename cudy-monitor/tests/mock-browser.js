// Synthetic telemetry for isolated UI screenshots only. Never included in the router binary.
(function(){
 const data={
   version:"1.0.0-preview",cpu:12.4,mem_total:486,mem_used:198,mem_cached:48,
   disk_total:14441,disk_used:208,disk_mount:"/opt",uptime:187457,monitor_rss_mb:1.15,
   cpu_mhz:1300,connections:1834,connections_max:65536,
   temps:[{name:"cpu-thermal",c:49.1}],
   cores:[{id:0,usage:10.2},{id:1,usage:15.3}],
   network:[{name:"eth2.4",rx:1351680,tx:225280},{name:"br0",rx:980000,tx:170000},{name:"ra9",rx:420000,tx:450000},{name:"ra1",rx:50000,tx:34000}],
   processes:[
    {name:"d2kd",pid:1050,mem:16,cpu:3.4},{name:"doqd",pid:895,mem:16,cpu:1.5},
    {name:"ndm",pid:420,mem:35,cpu:1.0},{name:"d2ktg",pid:1387,mem:10,cpu:0.8},
    {name:"nginx",pid:835,mem:7,cpu:0.3},{name:"cudy-monitor-pro",pid:2200,mem:1,cpu:0.1}],
   services:[{name:"D2K",detected:true,installed:true},{name:"DoQ",detected:true,installed:true},{name:"KeenKit",detected:false,installed:true}]
 };
 const samples=Array.from({length:80},(_,i)=>[i*10,12+7*Math.sin(i/6),40+Math.sin(i/15),49+Math.sin(i/9)]);
 const traffic=Array.from({length:90},(_,i)=>[i*2,400000+500000*(.5+.5*Math.sin(i/8)),50000+130000*(.5+.5*Math.cos(i/11))]);
 const original=window.fetch.bind(window);
 window.fetch=async function(url,options){
  const p=String(url);let payload;
  if(p.includes("/api/status"))payload=data;
  else if(p.includes("/api/network-history"))payload={interface:"eth2.4",max_points:150,interval_sec:2,points:traffic};
  else if(p.includes("/api/history"))payload={max_points:1080,interval_sec:10,points:samples};
  else if(p.includes("/api/logs"))payload={source:"monitor",max_events:80,events:[[0,"Монитор запущен"],[60,"Состояние системы нормально"]]};
  else if(p.includes("/api/update/check"))payload={current:"1.0.0-preview",latest:"1.0.0-preview",available:false};
  else return original(url,options);
  return {ok:true,status:200,json:async()=>payload};
 };
})();
