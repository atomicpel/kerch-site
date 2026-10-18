/* Помощник сетевика: всё считается в браузере, ничего не отправляется. */
(function () {
  'use strict';

  // ---------- IPv4 ----------
  function ipToInt(s) {
    var p = String(s).trim().split('.');
    if (p.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(p[i])) return null;
      var v = +p[i];
      if (v > 255) return null;
      n = n * 256 + v;
    }
    return n >>> 0;
  }
  function intToIp(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  function prefixToMask(p) { return p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0; }
  function maskToPrefix(m) {
    var p = 0, zero = false;
    for (var i = 31; i >= 0; i--) {
      if ((m >>> i) & 1) { if (zero) return null; p++; } else zero = true;
    }
    return p;
  }
  function parseCidr(input) {
    var s = String(input).trim().replace(/\s+/g, ' ');
    if (!s) return { error: 'Введите адрес, например 192.168.1.10/24' };
    var m = s.match(/^([^\s/]+)\s*\/\s*(\S+)$/) || s.match(/^(\S+)\s+(\S+)$/);
    if (!m) {
      if (ipToInt(s) !== null) return { error: 'Добавьте префикс или маску: 192.168.1.10/24 или 192.168.1.10 255.255.255.0' };
      return { error: 'Введите адрес, например 192.168.1.10/24' };
    }
    var ip = ipToInt(m[1]);
    if (ip === null) return { error: 'Некорректный IP-адрес: ' + m[1] };
    var pfx;
    if (/^\d{1,2}$/.test(m[2])) {
      pfx = +m[2];
      if (pfx > 32) return { error: 'Префикс должен быть от 0 до 32' };
    } else {
      var mk = ipToInt(m[2]);
      if (mk === null) return { error: 'Некорректная маска: ' + m[2] };
      pfx = maskToPrefix(mk);
      if (pfx === null) return { error: 'Маска должна быть непрерывной, например 255.255.255.0' };
    }
    return { ip: ip, pfx: pfx };
  }
  function inNet(ip, base, p) {
    var m = prefixToMask(p);
    return ((ip & m) >>> 0) === ((ipToInt(base) & m) >>> 0);
  }
  function kind(ip) {
    var t = [
      ['10.0.0.0', 8, 'частная (RFC 1918)'], ['172.16.0.0', 12, 'частная (RFC 1918)'],
      ['192.168.0.0', 16, 'частная (RFC 1918)'], ['100.64.0.0', 10, 'провайдерский NAT (CGNAT)'],
      ['127.0.0.0', 8, 'loopback'], ['169.254.0.0', 16, 'link-local (APIPA)'],
      ['224.0.0.0', 4, 'multicast'], ['0.0.0.0', 8, 'служебная'], ['240.0.0.0', 4, 'зарезервирована']
    ];
    for (var i = 0; i < t.length; i++) if (inNet(ip, t[i][0], t[i][1])) return t[i][2];
    return 'публичная';
  }
  function bin(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
      .map(function (x) { return ('00000000' + x.toString(2)).slice(-8); }).join('.');
  }
  function calc(ip, pfx) {
    var mask = prefixToMask(pfx);
    var net = (ip & mask) >>> 0;
    var bc = (net | (~mask >>> 0)) >>> 0;
    var size = Math.pow(2, 32 - pfx);
    var first, last, hosts;
    if (pfx === 32) { first = last = net; hosts = 1; }
    else if (pfx === 31) { first = net; last = bc; hosts = 2; }
    else { first = net + 1; last = bc - 1; hosts = size - 2; }
    return { ip: ip, pfx: pfx, mask: mask, wildcard: (~mask) >>> 0, net: net, bc: bc,
      first: first, last: last, hosts: hosts, size: size, type: kind(ip) };
  }
  function fmt(n) { return n.toLocaleString('ru-RU'); }

  // ---------- VLSM ----------
  function vlsm(baseStr, reqs) {
    var b = parseCidr(baseStr);
    if (b.error) return { error: b.error };
    var base = calc(b.ip, b.pfx);
    var items = reqs.filter(function (r) { return r.hosts > 0; })
      .map(function (r, i) { return { name: r.name || ('Сеть ' + (i + 1)), hosts: r.hosts, i: i }; })
      .sort(function (x, y) { return y.hosts - x.hosts || x.i - y.i; });
    if (!items.length) return { error: 'Добавьте хотя бы одну подсеть с числом хостов' };
    var cur = base.net, end = base.bc, out = [];
    for (var k = 0; k < items.length; k++) {
      var r = items[k], p = 30;
      while (p > 0 && Math.pow(2, 32 - p) - 2 < r.hosts) p--;
      if (p < base.pfx) return { error: '«' + r.name + '» (' + fmt(r.hosts) + ' хостов) больше всей сети ' + intToIp(base.net) + '/' + base.pfx, base: base, out: out };
      var size = Math.pow(2, 32 - p);
      var start = Math.ceil(cur / size) * size;
      if (start + size - 1 > end) return { error: 'Не хватает адресов: «' + r.name + '» уже не помещается. Возьмите сеть побольше.', base: base, out: out };
      var c = calc(start, p);
      c.name = r.name; c.need = r.hosts;
      out.push(c);
      cur = start + size;
    }
    return { base: base, out: out, free: end >= cur ? end - cur + 1 : 0 };
  }

  // ---------- порты для VLAN ----------
  function parsePorts(s) {
    s = String(s || '').replace(/\s+/g, '');
    if (!s) return [];
    var set = {}, parts = s.split(',');
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
      if (!m) return null;
      var a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b > 128 || a > b) return null;
      for (var x = a; x <= b; x++) set[x] = 1;
    }
    return Object.keys(set).map(Number).sort(function (x, y) { return x - y; });
  }
  function ranges(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i], b = a;
      while (i + 1 < list.length && list[i + 1] === b + 1) { b = list[++i]; }
      out.push([a, b]);
    }
    return out;
  }
  function rangeStr(list) {
    return ranges(list).map(function (r) { return r[0] === r[1] ? r[0] : r[0] + '-' + r[1]; }).join(',');
  }

  function buildVlan(o) {
    var lines, rs = ranges(o.access), trunk = o.trunk, gw = o.gw;
    var maskStr = gw ? intToIp(prefixToMask(gw.pfx)) : '';
    var gwIp = gw ? intToIp(gw.ip) : '';
    var res = {};

    // Cisco IOS
    lines = ['configure terminal', 'vlan ' + o.vid, ' name ' + o.name, 'exit'];
    for (var i = 0; i < rs.length; i += 5) {
      var chunk = rs.slice(i, i + 5).map(function (r) {
        return o.cisco + r[0] + (r[0] === r[1] ? '' : ' - ' + r[1]);
      }).join(' , ');
      lines.push('interface range ' + chunk, ' switchport mode access', ' switchport access vlan ' + o.vid, ' spanning-tree portfast', 'exit');
    }
    trunk.forEach(function (t) {
      lines.push('interface ' + o.cisco + t,
        ' switchport mode trunk', ' switchport trunk allowed vlan add ' + o.vid, 'exit');
    });
    if (gw) lines.push('interface vlan ' + o.vid, ' ip address ' + gwIp + ' ' + maskStr, ' no shutdown', 'exit');
    lines.push('end', 'write memory');
    res.cisco = lines.join('\n');

    // Eltex MES
    lines = ['configure', 'vlan database', ' vlan ' + o.vid, 'exit', 'interface vlan ' + o.vid, ' name ' + o.name];
    if (gw) lines.push(' ip address ' + gwIp + ' ' + maskStr);
    lines.push('exit');
    rs.forEach(function (r) {
      lines.push((r[0] === r[1] ? 'interface ' + o.eltex + r[0] : 'interface range ' + o.eltex + r[0] + '-' + r[1]),
        ' switchport mode access', ' switchport access vlan ' + o.vid, 'exit');
    });
    trunk.forEach(function (t) {
      lines.push('interface ' + o.eltex + t, ' switchport mode trunk', ' switchport trunk allowed vlan add ' + o.vid, 'exit');
    });
    lines.push('end', 'write');
    res.eltex = lines.join('\n');

    // D-Link DES/DGS (CLI)
    lines = ['create vlan ' + o.name + ' tag ' + o.vid];
    if (o.access.length) {
      lines.push('config vlan default delete ' + rangeStr(o.access),
        'config vlan ' + o.name + ' add untagged ' + rangeStr(o.access));
    }
    if (trunk.length) lines.push('config vlan ' + o.name + ' add tagged ' + rangeStr(trunk));
    if (gw) lines.push('create ipif vlan' + o.vid + ' ' + gwIp + '/' + gw.pfx + ' ' + o.name + ' state enable');
    lines.push('save');
    res.dlink = lines.join('\n');

    // MikroTik RouterOS 7
    var br = o.bridge, vif = 'vlan' + o.vid + '-' + o.name;
    var acc = o.access.map(function (p) { return o.mt + p; });
    var trk = trunk.map(function (p) { return o.mt + p; });
    lines = ['/interface bridge', 'add name=' + br + ' vlan-filtering=no',
      '/interface bridge port'];
    acc.forEach(function (p) { lines.push('add bridge=' + br + ' interface=' + p + ' pvid=' + o.vid + ' frame-types=admit-only-untagged-and-priority-tagged'); });
    trk.forEach(function (p) { lines.push('add bridge=' + br + ' interface=' + p + ' frame-types=admit-only-vlan-tagged'); });
    var tagged = (gw ? [br] : []).concat(trk);
    lines.push('/interface bridge vlan',
      'add bridge=' + br + ' vlan-ids=' + o.vid + (tagged.length ? ' tagged=' + tagged.join(',') : '') + (acc.length ? ' untagged=' + acc.join(',') : ''));
    if (gw) lines.push('/interface vlan', 'add interface=' + br + ' name=' + vif + ' vlan-id=' + o.vid,
      '/ip address', 'add address=' + gwIp + '/' + gw.pfx + ' interface=' + vif);
    lines.push('/interface bridge', 'set ' + br + ' vlan-filtering=yes');
    res.mikrotik = lines.join('\n');
    return res;
  }

  var NOTES = {
    cisco: 'На 3560/3750 перед switchport mode trunk добавьте switchport trunk encapsulation dot1q. Команда write memory сохраняет настройки.',
    eltex: 'Для MES23xx, 33xx и 53xx. На команду write коммутатор попросит подтверждение — ответьте y.',
    dlink: 'Для DES-3xxx и DGS-3xxx с классическим CLI. Порты сначала убираются из VLAN default. Строка create ipif нужна только на L3-моделях.',
    mikrotik: 'RouterOS 7, VLAN на мосту. vlan-filtering включается последней строкой — иначе можно потерять доступ. Если мост уже есть, пропустите строку add name=…; если порт уже в мосту, вместо add используйте set [find interface=…] pvid=…'
  };

  // ---------- справочник портов ----------
  var PORTS = [
    ['20, 21', 'TCP', 'FTP'], ['22', 'TCP', 'SSH, SFTP'], ['23', 'TCP', 'Telnet'], ['25', 'TCP', 'SMTP'],
    ['53', 'TCP/UDP', 'DNS'], ['67, 68', 'UDP', 'DHCP'], ['69', 'UDP', 'TFTP — прошивки и конфиги коммутаторов'],
    ['80', 'TCP', 'HTTP'], ['88', 'TCP/UDP', 'Kerberos (Active Directory)'], ['110', 'TCP', 'POP3'],
    ['123', 'UDP', 'NTP — время'], ['135', 'TCP', 'Microsoft RPC'], ['137–139', 'TCP/UDP', 'NetBIOS'],
    ['143', 'TCP', 'IMAP'], ['161, 162', 'UDP', 'SNMP, трапы'], ['389', 'TCP/UDP', 'LDAP'],
    ['443', 'TCP', 'HTTPS; Nextcloud, OnlyOffice, веб-интерфейсы'], ['445', 'TCP', 'SMB — общие папки Windows'],
    ['465', 'TCP', 'SMTP через SSL'], ['500, 4500', 'UDP', 'IPsec (IKE, NAT-T)'], ['514', 'UDP', 'Syslog'],
    ['554', 'TCP/UDP', 'RTSP — IP-камеры'], ['587', 'TCP', 'SMTP submission'], ['636', 'TCP', 'LDAPS'],
    ['902', 'TCP/UDP', 'VMware ESXi — консоль и управление'], ['993', 'TCP', 'IMAPS'], ['995', 'TCP', 'POP3S'],
    ['1194', 'UDP', 'OpenVPN'], ['1433', 'TCP', 'Microsoft SQL Server'], ['1540, 1541', 'TCP', '1С: агент и менеджер кластера'],
    ['1560–1591', 'TCP', '1С: рабочие процессы'], ['1701', 'UDP', 'L2TP'], ['1723', 'TCP', 'PPTP'],
    ['1812, 1813', 'UDP', 'RADIUS'], ['3268, 3269', 'TCP', 'Глобальный каталог AD'], ['3306', 'TCP', 'MySQL, MariaDB'],
    ['3389', 'TCP/UDP', 'RDP — удалённый рабочий стол'], ['4081', 'TCP', 'Kerio Control — администрирование'],
    ['5060, 5061', 'TCP/UDP', 'SIP'], ['5432', 'TCP', 'PostgreSQL'], ['5985, 5986', 'TCP', 'WinRM, PowerShell Remoting'],
    ['8000', 'TCP', 'Hikvision SDK'], ['8291', 'TCP', 'MikroTik Winbox'], ['8448', 'TCP', 'Matrix — федерация серверов'],
    ['8728, 8729', 'TCP', 'MikroTik API'], ['9100', 'TCP', 'Печать RAW (JetDirect)'], ['37777', 'TCP', 'Dahua'],
    ['51820', 'UDP', 'WireGuard']
  ];

  // ---------- общие помощники интерфейса ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function copyText(text, btn) {
    function done() { var t = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(function () { btn.textContent = t; }, 1400); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Выделите и скопируйте'; }
      document.body.removeChild(ta);
    }
  }
  function rows(target, pairs) {
    target.innerHTML = '';
    pairs.forEach(function (p) {
      var dt = el('dt', '', p[0]), dd = el('dd', p[2] || '', p[1]);
      target.appendChild(dt); target.appendChild(dd);
    });
  }

  // ---------- мини-калькулятор на главной ----------
  var mini = $('mini-calc');
  if (mini) {
    var mi = $('mini-in'), mo = $('mini-out'), me = $('mini-err');
    var runMini = function () {
      var r = parseCidr(mi.value);
      if (r.error) { me.textContent = r.error; mo.hidden = true; return; }
      me.textContent = ''; mo.hidden = false;
      var c = calc(r.ip, r.pfx);
      rows(mo, [
        ['Сеть', intToIp(c.net) + '/' + c.pfx], ['Маска', intToIp(c.mask)],
        ['Хостов', fmt(c.hosts)], ['Диапазон', intToIp(c.first) + ' — ' + intToIp(c.last)]
      ]);
    };
    mi.addEventListener('input', runMini); runMini();
  }

  // ---------- IP-калькулятор ----------
  if ($('calc-in')) {
    var ci = $('calc-in'), co = $('calc-out'), ce = $('calc-err');
    var runCalc = function () {
      var r = parseCidr(ci.value);
      if (r.error) { ce.textContent = r.error; co.hidden = true; return; }
      ce.textContent = ''; co.hidden = false;
      var c = calc(r.ip, r.pfx);
      rows(co, [
        ['Адрес', intToIp(c.ip) + ' — ' + c.type],
        ['Сеть', intToIp(c.net) + '/' + c.pfx],
        ['Маска', intToIp(c.mask)],
        ['Wildcard (для ACL и OSPF)', intToIp(c.wildcard)],
        ['Broadcast', c.pfx >= 31 ? 'нет' : intToIp(c.bc)],
        ['Первый хост', intToIp(c.first)],
        ['Последний хост', intToIp(c.last)],
        ['Хостов', fmt(c.hosts) + (c.pfx === 31 ? ' (точка-точка, RFC 3021)' : '')],
        ['Маска в битах', bin(c.mask), 'bits']
      ]);
    };
    ci.addEventListener('input', runCalc);
    document.querySelectorAll('[data-try]').forEach(function (b) {
      b.addEventListener('click', function () { ci.value = b.getAttribute('data-try'); runCalc(); ci.focus(); });
    });
    runCalc();
  }

  // ---------- разбивка на подсети ----------
  if ($('vlsm-base')) {
    var vb = $('vlsm-base'), vlist = $('vlsm-rows'), vout = $('vlsm-out'), verr = $('vlsm-err'), vsum = $('vlsm-sum');
    var addRow = function (name, hosts) {
      var li = el('li', 'vrow');
      var n = el('input'); n.type = 'text'; n.value = name || ''; n.placeholder = 'Название'; n.setAttribute('aria-label', 'Название подсети'); n.maxLength = 40;
      var h = el('input'); h.type = 'number'; h.min = '1'; h.max = '16777214'; h.value = hosts || ''; h.placeholder = 'Хостов'; h.setAttribute('aria-label', 'Сколько нужно хостов'); h.inputMode = 'numeric';
      var x = el('button', 'icon-btn', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Удалить подсеть');
      x.addEventListener('click', function () { li.remove(); runVlsm(); });
      [n, h].forEach(function (i) { i.addEventListener('input', runVlsm); });
      li.appendChild(n); li.appendChild(h); li.appendChild(x); vlist.appendChild(li);
      return n;
    };
    var runVlsm = function () {
      var reqs = [].map.call(vlist.querySelectorAll('.vrow'), function (li) {
        var i = li.querySelectorAll('input'); return { name: i[0].value.trim(), hosts: Math.floor(+i[1].value) || 0 };
      });
      var r = vlsm(vb.value, reqs);
      verr.textContent = r.error || '';
      var body = vout.querySelector('tbody'); body.innerHTML = '';
      (r.out || []).forEach(function (c) {
        var tr = el('tr');
        [c.name, fmt(c.need), intToIp(c.net) + '/' + c.pfx, intToIp(c.mask), intToIp(c.first) + ' — ' + intToIp(c.last), intToIp(c.bc), fmt(c.hosts)]
          .forEach(function (v) { tr.appendChild(el('td', '', v)); });
        body.appendChild(tr);
      });
      vout.hidden = !(r.out && r.out.length);
      vsum.textContent = (!r.error && r.base) ? 'Свободно после разбивки: ' + fmt(r.free) + ' адресов из ' + fmt(r.base.size) + '.' : '';
    };
    vb.addEventListener('input', runVlsm);
    $('vlsm-add').addEventListener('click', function () { addRow('', '').focus(); runVlsm(); });
    [['Офис', 100], ['Камеры', 50], ['Гостевой Wi-Fi', 30], ['Принтеры', 10], ['Управление', 6]].forEach(function (d) { addRow(d[0], d[1]); });
    runVlsm();
  }

  // ---------- генератор VLAN ----------
  if ($('vlan-form')) {
    var f = $('vlan-form'), verr2 = $('vlan-err'), pre = $('vlan-code'), tabs = [].slice.call(document.querySelectorAll('[role=tab][data-vendor]'));
    var vendor = 'cisco', last = null;
    var runVlan = function () {
      var vid = +$('v-id').value, name = $('v-name').value.trim();
      var access = parsePorts($('v-access').value), trunk = parsePorts($('v-trunk').value);
      var gwS = $('v-gw').value.trim(), gw = null, err = '';
      if (!(vid >= 2 && vid <= 4094) || Math.floor(vid) !== vid) err = 'Номер VLAN — от 2 до 4094 (1 — служебный).';
      else if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) err = 'Имя VLAN — латиница, цифры, «-» и «_», без пробелов, до 32 символов.';
      else if (access === null) err = 'Порты доступа: номера через запятую или диапазоны, например 1-8,10.';
      else if (trunk === null) err = 'Магистральные порты: номера через запятую, например 24 или 23,24.';
      else if (!access.length && !trunk.length) err = 'Укажите хотя бы один порт.';
      else if (access.some(function (p) { return trunk.indexOf(p) >= 0; })) err = 'Один и тот же порт не может быть и портом доступа, и магистральным.';
      else if (gwS) {
        var g = parseCidr(gwS);
        if (g.error) err = 'Шлюз: ' + g.error;
        else if (g.pfx > 30) err = 'Шлюзу нужна сеть с префиксом не больше /30.';
        else {
          var gc = calc(g.ip, g.pfx);
          if (g.ip === gc.net) err = 'Шлюз совпадает с адресом сети — возьмите, например, ' + intToIp(gc.first) + '/' + g.pfx + '.';
          else if (g.ip === gc.bc) err = 'Шлюз совпадает с broadcast-адресом — возьмите другой адрес из сети.';
          else gw = g;
        }
      }
      verr2.textContent = err;
      if (err) { pre.textContent = ''; last = null; return; }
      last = buildVlan({
        vid: vid, name: name, access: access, trunk: trunk, gw: gw,
        cisco: $('v-cisco').value || 'GigabitEthernet1/0/', eltex: $('v-eltex').value || 'gigabitethernet 1/0/',
        mt: $('v-mt').value || 'ether', bridge: $('v-bridge').value || 'bridge1'
      });
      pre.textContent = last[vendor];
    };
    var note = $('vlan-note');
    var setNote = function () { if (note) note.textContent = NOTES[vendor]; };
    f.addEventListener('input', runVlan);
    f.addEventListener('submit', function (e) { e.preventDefault(); });
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        vendor = t.getAttribute('data-vendor');
        tabs.forEach(function (o) { var on = o === t; o.setAttribute('aria-selected', on ? 'true' : 'false'); o.tabIndex = on ? 0 : -1; });
        $('vlan-panel').setAttribute('aria-labelledby', t.id);
        if (last) pre.textContent = last[vendor];
        setNote();
      });
      t.addEventListener('keydown', function (e) {
        var i = tabs.indexOf(t), j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
        if (j < 0 && e.key !== 'ArrowLeft') return;
        j = (j + tabs.length) % tabs.length; tabs[j].focus(); tabs[j].click(); e.preventDefault();
      });
    });
    $('vlan-copy').addEventListener('click', function () { if (pre.textContent) copyText(pre.textContent, this); });
    runVlan(); setNote();
  }

  // ---------- справочник портов ----------
  if ($('ports-in')) {
    var pi = $('ports-in'), pb = $('ports-body'), pn = $('ports-none');
    var drawPorts = function () {
      var q = pi.value.trim().toLowerCase(), shown = 0;
      pb.innerHTML = '';
      PORTS.forEach(function (r) {
        if (q && (r[0] + ' ' + r[1] + ' ' + r[2]).toLowerCase().indexOf(q) < 0) return;
        var tr = el('tr'); r.forEach(function (v) { tr.appendChild(el('td', '', v)); }); pb.appendChild(tr); shown++;
      });
      pn.hidden = shown > 0;
    };
    pi.addEventListener('input', drawPorts); drawPorts();
  }

  window.NetHelper = { parseCidr: parseCidr, calc: calc, vlsm: vlsm, parsePorts: parsePorts, buildVlan: buildVlan, intToIp: intToIp };
})();
