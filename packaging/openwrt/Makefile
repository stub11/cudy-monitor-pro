include $(TOPDIR)/rules.mk

PKG_NAME:=cudy-monitor-pro
PKG_VERSION:=1.2.8
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Cudy Monitor Contributors
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/cudy-monitor-pro
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Cudy Monitor Pro lightweight ARM64 router dashboard
  URL:=https://github.com/stub11/cudy-monitor-pro
  DEPENDS:=+libc
endef

define Package/cudy-monitor-pro/description
  Local router resource monitor with embedded web UI.
  Native OpenWrt 25.12 package using procd; Entware is not required.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
	test -s $(CURDIR)/files/cudy-monitor-pro
endef

define Package/cudy-monitor-pro/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/etc/init.d $(1)/usr/share/cudy-monitor-pro
	$(INSTALL_BIN) $(CURDIR)/files/cudy-monitor-pro $(1)/usr/bin/cudy-monitor-pro
	$(INSTALL_BIN) $(CURDIR)/files/cudy-monitor-pro.init $(1)/etc/init.d/cudy-monitor-pro
	$(INSTALL_BIN) $(CURDIR)/files/cudy-monitor-lan $(1)/usr/bin/cudy-monitor-lan
	$(INSTALL_BIN) $(CURDIR)/files/detect-lan.sh $(1)/usr/share/cudy-monitor-pro/detect-lan.sh
	$(INSTALL_BIN) $(CURDIR)/files/update-native.sh $(1)/usr/share/cudy-monitor-pro/update-native.sh
endef

define Package/cudy-monitor-pro/postinst
#!/bin/sh
[ -n "$$$$IPKG_INSTROOT" ] && exit 0
mkdir -p /etc/cudy-monitor-pro
chmod 700 /etc/cudy-monitor-pro
if [ ! -e /etc/cudy-monitor-pro/bind ]; then
  printf '%s\n' '127.0.0.1:8237' > /etc/cudy-monitor-pro/bind
fi
chmod 600 /etc/cudy-monitor-pro/bind
# Default to the unique assigned trusted LAN IPv4; leave existing custom binds unchanged.
# Ambiguous LAN addresses fall back to loopback instead of guessing.
if grep -qx "127.0.0.1:8237" /etc/cudy-monitor-pro/bind; then
  LAN_IP=$$$$(/bin/sh /usr/share/cudy-monitor-pro/detect-lan.sh detect 2>/dev/null) || LAN_IP=
  if [ -n "$$$$LAN_IP" ]; then
    printf '%s:8237\n' "$$$$LAN_IP" > /etc/cudy-monitor-pro/bind
    chmod 600 /etc/cudy-monitor-pro/bind
  fi
fi
if [ -x /opt/bin/cudy-monitor-pro ]; then
  echo "Existing Entware monitor detected; native service not enabled to avoid duplicate port binding." >&2
  exit 0
fi
/etc/init.d/cudy-monitor-pro enable || true
/etc/init.d/cudy-monitor-pro restart || true
exit 0
endef

define Package/cudy-monitor-pro/prerm
#!/bin/sh
[ -n "$$$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/cudy-monitor-pro stop >/dev/null 2>&1 || true
/etc/init.d/cudy-monitor-pro disable >/dev/null 2>&1 || true
exit 0
endef

$(eval $(call BuildPackage,cudy-monitor-pro))
