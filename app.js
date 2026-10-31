/*
White = poweron
yellow = connectinng
cyan = connected, polling
red = data not provided yet
green = all ok, getting data
blue moving = scanning
blue = connectable
dim blue = exiting connectable + stopping
*/
var wifi = require("Wifi");
var http = require("http");
var serial = getSerial();
var ID;
var log = print;

function onConnected() {
  Badge.setLEDs("#012");
  if (require("Storage").read("pair.epaper") === undefined ||
      require("Storage").read("connect.epaper") === undefined) {
    return httpGetImage(`${WIFI_INFO.badgeURL}/img/pair?raw=1&serial=${serial}`, "pair.epaper").then(fn => {
      Badge.setLEDs("#021");
      httpGetImage(`${WIFI_INFO.badgeURL}/img/connect?raw=1&serial=${serial}&dev=${encodeURIComponent(NRF.getAdvertisingName())}`, "connect.epaper").then(fn => {
        wifi.disconnect();
        Badge.setLEDs("#730");
        Badge.showImageFile("pair.epaper").then(() => {
          require("Storage").write("showing", "pair");
          Badge.sleep();
        });
      });
    });
  }
  if (require("Storage").read("showing") != "pair") {
    return Badge.showImageFile("pair.epaper").then(() => {
      require("Storage").write("showing", "pair");
      Badge.sleep();
    });
  }

  httpGet(`${WIFI_INFO.badgeURL}/status?serial=${encodeURIComponent(serial)}`).then(res => {
    let json = {};
    try { json = JSON.parse(res) } catch (e) {};
    if (json.ok) { // SUCCESS - save ID
      Badge.setLEDs("#010");
      ID = json.info;
      require("Storage").writeJSON("id.json",ID);
      return httpGetImage(`${WIFI_INFO.badgeURL}/img/badge?raw=1&serial=${encodeURIComponent(serial)}`, "badge.epaper").then(fn => {
        showBadge();
        httpGetImage(`${WIFI_INFO.badgeURL}/img/prog?raw=1&serial=${encodeURIComponent(serial)}`, "programme.epaper").then(fn => {
          wifi.disconnect();
          setTimeout(function() {
            Badge.sleep();
          }, 10000);
        });
      })
    } else { // NOT READY - show red, turn off and wait
      Badge.setLEDs("#100");
      require("Storage").erase("id.json");
      wifi.disconnect();
      setTimeout(function() {
        Badge.sleep();
      }, 5000);
    }
  });
}

function httpGet(url, retries) {
  log("GET ",url);
  retries=0|retries;
  return new Promise((resolve,reject) => {
    var timeout = setTimeout(function() {
      reject("HTTP Timeout");
    }, 10000);
    http.get(url, function(res) {
      let d="";
      res.on('data', function(data) { d += data; });
      res.on('close', function() {
        clearTimeout(timeout);
        log("GET success");
        resolve(d);
      });
    });
  }).catch(e => {
    log(e);
    if (++retries<3) {
      log(`Retry ${retries}...`);
      return new Promise(r=>setTimeout(r,1000)).then(() => httpGet(url, retries));
    } else return Badge.showError(e).then(() => {
        Badge.sleep();
      });
  });
}

function httpGetImage(url, fn, retries) {
  log("GET image ",url);
  retries=0|retries;
  return new Promise((resolve,reject) => {
    var timeout = setTimeout(function() {
      reject("HTTP Timeout");
    }, 15000);
    http.get(url, function(res) {
      let offs = 0, len = 800*480*2/8;
      res.on('data', function(data) {
        if (data.length==0) return;
        if (offs==0)
          require("Storage").write(fn,data,0,len);
        else
          require("Storage").write(fn,data,offs);
        offs += data.length;
      });
      res.on('close', function() {
        clearTimeout(timeout);
        if (offs!=96000) {
          return reject(`Truncated image (${offs}b vs 96k)`);
        }
        log("GET success");
        resolve(fn);
      });
    });
  }).catch(e => {
    require("Storage").erase(fn); // ensure we don't keep any partial files
    log(e);
    if (++retries<3) {
      log(`Retry ${retries}...`);
      return new Promise(r=>setTimeout(r,1000)).then(() => httpGetImage(url, fn, retries));
    } else return Badge.showError(e).then(() => {
        Badge.sleep();
      });
  });
}

function httpPost(post_url, payload, saveToFile, retries) {
  log("POST ", post_url);
  retries=0|retries;
  return new Promise((resolve,reject) => {
    var options = Object.assign(url.parse(post_url), {
      method: 'POST',
      headers: {
        "Content-Length" : payload.length,
        "Content-Type" : "application/json"
      }
    });
    var timeout = setTimeout(function() {
      reject("HTTP Timeout");
    }, 30000);
    var req = require("http").request(options, function(res) {
      console.log("POST opened"/*,res*/);
      date = new Date(res.headers.Date);
      var dataLen = 0|res.headers["Content-Length"];
      var dataOffs = 0, data = "";
      res.on('data', d => {
        if (saveToFile) require("Storage").write(saveToFile, d, dataOffs, dataLen);
        else data += d;
        dataOffs += d.length;
      });
      res.on('close', function() {
        clearTimeout(timeout);
        log("POST success");
        resolve(data);
      });
    });
    req.end(payload);
  }).catch(e => {
    log(e);
    if (++retries<3) {
      log(`Retry ${retries}...`);
      return new Promise(r=>setTimeout(r,1000)).then(() => httpPost(post_url, payload, saveToFile, retries));
    } else return Badge.showError(e).then(() => {
        Badge.sleep();
      });
  });
}


function addUserInfo(deviceAddress) {
  log("Device Found>", deviceAddress);
  // Check for duplicates?
  let f = require("Storage").open("scans.txt","r");
  let l = f.readLine();
  while (l) {
    if (l.trim() == deviceAddress) {
      console.log("Existing device found!");
      return 0;
    }
    l = f.readLine();
  }
  require("Storage").open("scans.txt","a").write(deviceAddress+"\n");
  return 1;
}

function setConnectableMode() {
  console.log("Connectable mode");
  Badge.setLEDs("#007");
  return Badge.showImageFile("connect.epaper").then(() => {
    require("Storage").write("showing", "connect");
    setWatch(function() { // next button press - turn off
      console.log("BTN2 pressed again");
      NRF.sleep();
      Badge.setLEDs("#0f0600");
      showBadge({noLEDs:true}).then(() => Badge.sleep());
    }, BTN2, {edge:"rising"});
  });
}

// Scan for other badges in range. Doesn't return (goes to sleep eventually)
Badge.scan = function() {
  const SCAN_TIMEOUT = 4000;
  // left-right bluetooth scan LED effect
  let arr = new Uint24Array(Badge.led_rgb.buffer);
  let animInt = setInterval(function() {
    var n = 4.5+3*Math.sin(getTime()*2);
    for (var i=0;i<10;i++)
      arr[i] = E.HSBtoRGB(0.7,1,Math.pow(E.clip(1-0.2*Math.abs(i-n),0,1),2)*0.2);
    Badge.setLEDArray();
  }, 50);
  let timeout;
  // Set up Bluetooth advertising to advertise our ID
  NRF.wake();
  let manufacturerData = new Uint32Array([ID.id]);
  NRF.setAdvertising({},{manufacturerData:manufacturerData.buffer});
  // Now scan...
  NRF.findDevices(function(devices) {
    clearInterval(animInt);
    if (BTN2.read()) {
      // button 2 still held -> connectable mode! Stay awake, show connectable page
      return setConnectableMode();
    }
    NRF.sleep();
    devices = devices.filter(d => d.rssi > -85 &&
                                  d.manufacturerData &&
                                  d.manufacturerData.length==4);
    if (devices.length) { // yes! we got something
      let newInfo = 0;
      devices.forEach(dev => {
        let id = (new Uint32Array(dev.manufacturerData))[0];
        newInfo += addUserInfo(id);
      });
      if (newInfo) {
        Badge.setLEDs("#0f0");
        timeout = setTimeout(function() {
          timeout = undefined;
          Badge.setLEDs();
        }, 2000);
        showBadge({noLEDs:true}).then(waitForUpload); // update number of connections shown
      } else {
        Badge.setLEDs("#880");
        setTimeout(waitForUpload, 1000);
      }
    } else { // uh-on, no devices
      Badge.setLEDs("#f00");
      timeout = setTimeout(function() {
        timeout = undefined;
        Badge.sleep(); // don't upload if no badges found
      }, 1000);
    }
  }, { filters: [{ manufacturerData:{0x0590:{}} }], timeout : SCAN_TIMEOUT });
};


function uploadScans() {
  log("Connecting");
  Badge.setLEDs("#110");
  return Badge.connectWiFi().then(() => {
    Badge.setLEDs("#011");
    let f = require("Storage").open("scans.txt","r");
    let l = f.readLine();
    let connections = "["; // newline-separated
    while (l) { // just assemble JSON here rather than wasting memory creating an array and stringifying it
      connections += JSON.stringify(l.trim())+",";
      l = f.readLine();
    }
    connections+="0]";
    Badge.setLEDs("#001");
    return httpPost(`${WIFI_INFO.badgeURL}/scan-post?serial=${encodeURIComponent(serial)}`, connections, "connections.json");
  }).then(data => {
    return new Promise(r => setTimeout(r,500));
  }).then(() => {
    Badge.sleep();
  }).catch(e=>{
    Badge.showError(e).then(() => {
      Badge.sleep();
    });
  });
}

/* This leaves the badge waiting for idle. It behaves
normally (2 buttons work) but once inactive for a few minutes
it'll upload the latest scans to the server. */
function waitForUpload() {
  // leds off
  Badge.setLEDs();
  // handle button presses as normal
  let b1Watch = setWatch(function() {
    tidy();
    btn1Pressed();
  }, BTN1);
  let b2Watch = setWatch(function() {
    tidy();
    btn2Pressed();
  }, BTN2);
  let idleTimeout = setTimeout(function() {
    idleTimeout = undefined;
    tidy();
    uploadScans();
  }, 30000); // 30 second timeout
  function tidy() {
    clearWatch(b1Watch);
    clearWatch(b2Watch);
    if (idleTimeout) clearTimeout(idleTimeout);
    b1Watch = b2Watch = idleTimeout = undefined;
  }

}

// QR code -> LinkedIn profile. Regenerate with: python3 tools/make_qr.py [url]
// https://www.linkedin.com/in/prafullkotecha  (version 3, ECC M)
var QR_N = 29, QR_STRIDE = 4;
var QR_DATA = atob("/k9z+IJfKgi6A9LoujIy6LpF4uiCtToI/qqr+ABBeACW17UAteyGSPusXnD1TaWwV63eWFSgHQB7nGh4uZ/wUALwzRB46sdIqpLNGCzwTBizhq+gAMSYuP4eypCCnSj4umrPgLqwcvC6PvDogl5ekP7Sz5A=");
// Layout on the 480x800 portrait screen (g.setRotation(1) coords):
// white box with QR_MARGIN modules of quiet zone, centred between company name and #WebAI
var QR_SCALE = 6, QR_MARGIN = 1, QR_Y = 593;

// Keep the photo and name boxes of badge.epaper, turn everything else white (drops the
// background and the "#WebAI" text). [x0,x1,y0,y1,corner radius] in portrait pixels,
// measured from the image on the badge.
var BOXES = [[49,430,19,403,22],[33,447,429,574,22]];

// Turn everything outside the two BOXES white on one band (g already rotated, dx as in drawQR). Native
// fillRects: the per-row byte masking this replaces took ~84s per draw. Corner pieces are cached.
var BOX_CORNERS;
function cleanBand(g, dx) {
  let A = BOXES[0], B = BOXES[1];
  g.setColor(1);
  [[0,0,479,A[2]-1], [0,A[2],A[0]-1,A[3]], [A[1]+1,A[2],479,A[3]], [0,A[3]+1,479,B[2]-1],
   [0,B[2],B[0]-1,B[3]], [B[1]+1,B[2],479,B[3]], [0,B[3]+1,479,799]].forEach(function(r) {
    g.fillRect(r[0]+dx, r[1], r[2]+dx, r[3]);
  });
  if (!BOX_CORNERS) {
    BOX_CORNERS = [];
    BOXES.forEach(function(b) {
      let r = b[4];
      for (let d=0;d<r;d++) {
        let ins = r-Math.round(Math.sqrt(r*r-(r-d)*(r-d)));
        if (ins<1) continue;
        [b[0]+d, b[1]-d].forEach(function(x) {
          BOX_CORNERS.push([x,b[2],b[2]+ins-1], [x,b[3]-ins+1,b[3]]);
        });
      }
    });
  }
  BOX_CORNERS.forEach(function(c) {
    let x = c[0]+dx;
    if (x>=0 && x<48) g.fillRect(x, c[1], x, c[2]);
  });
}

// Draw QR (call with g already rotated). dx shifts x so the 48px-wide band that
// starts at screen column X can be drawn with dx=-X; drawing is clipped to the band.
// Optional data/scale/x/y draw another code (default: the LinkedIn one, centred at QR_Y).
function drawQR(g, dx, data, scale, x, y) {
  data = data||QR_DATA; scale = scale||QR_SCALE; y = y===undefined ? QR_Y : y;
  let size = (QR_N+2*QR_MARGIN)*scale;
  let x0 = (x===undefined ? (480-size)>>1 : x) + dx;
  if (x0>47 || x0+size<0) return; // not in this band
  g.setColor(1).fillRect(x0, y, x0+size-1, y+size-1); // white
  g.setColor(0); // black
  x0 += QR_MARGIN*scale;
  let y0 = y + QR_MARGIN*scale;
  // only the module columns that fall inside this 48px band, vertical runs drawn as one rect
  for (let c=Math.max(0,Math.floor(-x0/scale)); c<QR_N && x0+c*scale<48; c++) {
    let r = 0;
    while (r<QR_N) {
      while (r<QR_N && !((data.charCodeAt(r*QR_STRIDE+(c>>3))>>(7-(c&7)))&1)) r++;
      let r0 = r;
      while (r<QR_N && ((data.charCodeAt(r*QR_STRIDE+(c>>3))>>(7-(c&7)))&1)) r++;
      if (r>r0) g.fillRect(x0+c*scale, y0+r0*scale, x0+(c+1)*scale-1, y0+r*scale-1);
    }
  }
}

// Badge.showImageFileRendering only lets the callback touch the first 48 rows (the left
// 48px strip in portrait). This streams the whole image in 48-row bands instead, calling
// cb(g, dx) per band, where dx is the x shift for that band (portrait coords, rotation 1).
// file: image to start from (badge.epaper, cleaned up with cleanRow) or undefined for a white page.
function renderBands(file, cb) {
  return Badge.showRaw(function(eD, resolve) {
    try {
      let St = require("Storage");
      if (file && St.read(file,0,1)===undefined) throw new Error(file+" not found");
      let g = Graphics.createArrayBuffer(800,48,2);
      let px = new Uint8Array(g.buffer);
      // progress bar: the button press turned all 10 LEDs amber (showBadge/showProgrammme);
      // each finished band turns one white, so the user can see it's working
      let led = new Uint24Array(Badge.led_rgb.buffer);
      for (let y=0;y<480;y+=48) {
        g.setRotation(0);
        g.setBgColor(1).setColor(0);
        if (file) {
          // read just this band; indexing into the whole flash-backed string was what made this ~90s
          px.set(new Uint8Array(E.toArrayBuffer(St.read(file, y*200, 9600))));
        } else px.fill(0x55); // white
        g.setRotation(1);
        cb(g, -y);
        eD(g.buffer);
        led[y/48] = 0x101010;
        Badge.setLEDArray();
      }
    } catch (e) { log(e); }
    resolve();
  });
}
function renderBadge(cb) { return renderBands("badge.epaper", cb); }

// GitHub profile pages (snapshots, replace the agenda). Side button steps badge -> page 0 -> 1 -> 2 -> badge.
// GH_DATA = contribution levels 0-4, 7 rows (Sun..Sat) x 53 weeks (tools/make_github.py).
// repos.json (Storage) = {r:[[name,lang,desc,colour]x20], L:[[lang,percent,colour]x4]} (tools/make_repos.py).
// Colours are badge pixel values: 0 black, 1 white, 2 yellow, 3 red.
var GH_DATA = "02000000000000100024211111000011000000000024011110124010000000000000010111110111000000100000100140101110240101100000000000000000010010010001010001011101111123300011000000000010000000110000000000000000012000221232100100001110111100000000000000000000001101110011223321000000000000000000010010000010000000000001101112121120000000001000001101111011000000100001100120011001140";
// https://github.com/prafullkotecha (version 3, same size as QR_DATA; tools/make_qr.py)
// https://github.com/prafullkotecha (version 3, same size as QR_DATA; tools/make_qr.py)
var GH_QR_DATA = atob("/vHj+ILI0gi6+bLougDK6Lqj0uiCGcII/qqr+AB9iACflNy4GZT1sOLVSaBcLOdI86WTCAzGY/hafR6oULCxqLNDHEDhXzCw37mwyN0iEmDGLs/wAOtowP6jmsCCm9iYuoef2LqNhAi6Dw24gmAjaP7BGoA=");
var GH_PAGES = 3, GH_REPOS = null;
var GH_ROW_Y = [500,626]; // top of the two heatmap rows (weeks 0-26, 27-52); cell pitch 16, size 14

// One heatmap/legend cell at x,y (levels as in GitHub: 0 none ... 4 most)
function ghCell(g, l, x, y) {
  if (l==0) g.setColor(0).fillRect(x+6,y+6,x+7,y+7);
  else if (l==4) g.setColor(0).fillRect(x,y,x+13,y+13);
  else {
    g.setColor(l==3 ? 3 : 2).fillRect(x,y,x+13,y+13);
    if (l==2) g.setColor(3).fillRect(x+4,y+4,x+9,y+9);
  }
}

// One repository: colour square, name, language (right aligned) and a description line
function ghRepo(g, dx, r, y) {
  let T = function(s, x, y) { g.setFont("6x8", 2).setFontAlign(-1,-1).drawString(s, x+dx, y); };
  g.setColor(r[3]).fillRect(24+dx,y+1,37+dx,y+14);
  g.setColor(0);
  T(r[0], 46, y);
  T(r[1], 456-r[1].length*12, y);
  T(r[2], 46, y+22);
}

function drawGitHub(g, dx, page) {
  let T = function(s, x, y, sc) { g.setFont("6x8", sc).setFontAlign(-1,-1).drawString(s, x+dx, y); };
  g.setColor(0);
  T("Prafull Kotecha", 24, 24, 3);
  T("github.com/prafullkotecha", 24, 62, 2);
  drawQR(g, dx, GH_QR_DATA, 4, 336, 20); // right of the header text, 124px
  g.setColor(0);
  let R = GH_REPOS;
  if (page==0) {
    T("4,161 contributions", 24, 90, 2);
    T("in the last year", 24, 110, 2);
    T("Highlights", 24, 160, 3);
    if (R) for (let i=0;i<4;i++) ghRepo(g, dx, R.r[i], 194+i*52);
    // languages: stacked bar over the whole width, legend below
    g.setColor(0);
    T("Languages", 24, 410, 2);
    if (R) {
      let x = 24;
      R.L.forEach(function(l, i) {
        let w = i==R.L.length-1 ? 456-x : Math.round(l[1]*432/100);
        if (l[2]==1) g.setColor(0).drawRect(x+dx,432,x+w-1+dx,451);
        else g.setColor(l[2]).fillRect(x+dx,432,x+w-1+dx,451);
        x += w;
      });
      x = 24;
      R.L.forEach(function(l) {
        let t = (l[0]=="other" ? "rest" : l[0])+" "+l[1]+"%";
        if (l[2]==1) g.setColor(0).drawRect(x+dx,463,x+11+dx,474);
        else g.setColor(l[2]).fillRect(x+dx,463,x+11+dx,474);
        g.setColor(0);
        T(t, x+18, 460, 2);
        x += 18+t.length*12+14;
      });
    }
    for (let w=0;w<53;w++) {
      let h = w>=27 ? 1 : 0, x = 24+(w-27*h)*16+dx;
      if (x>47 || x+14<0) continue;
      for (let d=0;d<7;d++) ghCell(g, GH_DATA.charCodeAt(d*53+w)-48, x, GH_ROW_Y[h]+d*16);
    }
    g.setColor(0);
    T("Less", 24, 750, 2);
    for (let l=0;l<5;l++) {
      let x = 90+l*22+dx;
      if (x>47 || x+14<0) continue;
      ghCell(g, l, x, 752);
    }
    g.setColor(0);
    T("More", 210, 750, 2);
  } else {
    let first = page==1 ? 4 : 12;
    T("More projects", 24, 90, 2);
    T("page "+(page+1)+" of "+GH_PAGES, 24, 110, 2);
    if (R) for (let i=0;i<8;i++) ghRepo(g, dx, R.r[first+i], 170+i*64);
  }
}
function renderGitHub(page) {
  GH_REPOS = require("Storage").readJSON("repos.json", 1);
  return renderBands(undefined, function(g, dx) { drawGitHub(g, dx, page); }).then(function() {
    GH_REPOS = null; // free the RAM again before sleeping
  });
}

function showBadge(options) {
  options = options||{};
  if (!options.noLEDs)
    Badge.setLEDs("#730");
  //return Badge.showImageFile("badge.epaper").then(() => require("Storage").write("showing", "badge"));
  let connectionCount = 0;
  let f = require("Storage").open("scans.txt","r");
  let l = f.readLine();
  while (l) {
    connectionCount++;
    l = f.readLine();
  }
  return renderBadge(function(g, dx) {
    cleanBand(g, dx);
    let img = atob("ICOBAAABgAAAD/AAAB/4AAA//AAAf/4AAH/+AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAAf/4AAH/+AAA//AAAH/gAAB/4AAAf+AAAH/gAAB/4AAB//gAB//+AB///4B////g////8f////n////7/////////////////////");
    //g.setBgColor(1).clearRect(0,735,47,799);
    g.setColor(0).drawImage(img, 24-16+dx, 759);
    g.setFont("22").setFontAlign(0,0).drawString(connectionCount, 24+dx,745);
    drawQR(g, dx);
  }).then(() => require("Storage").write("showing", "badge"));
}

function showGitHub(page) {
  Badge.setLEDs("#730");
  return renderGitHub(page).then(() => require("Storage").write("showing", "gh"+page));
}

// Short press: badge <-> GitHub page 0 (highlights). Hold (button still down after the 1s check in
// startup()): step through the "more projects" pages 1 -> 2 -> 0, so they stay out of the way otherwise.
function btn1Pressed(hold) {
  log("Button 1 -> display"+(hold ? " (held)" : ""));
  let s = require("Storage").read("showing");
  let cur = s=="badge" ? -1 : (s=="programme" ? 0 : (s && s.substr(0,2)=="gh" ? +s.substr(2) : -2));
  let p = hold ? (cur<1 ? 1 : (cur+1)%GH_PAGES) : (cur==-1 ? 0 : -1);
  if (p>=0)
    showGitHub(p).then(() => Badge.sleep());
  else
    showBadge().then(() => Badge.sleep());
}

function btn2Pressed() {
  log("Button 2 -> scan");
  // badge scan
  Badge.scan();
}

// Finally, startup....
function startup() {
  ID = require("Storage").readJSON("id.json",1);
  if (ID === undefined) { // no ID - pairing process
    log("Connecting");
    Badge.setLEDs("#110");
    Badge.connectWiFi().then(onConnected).catch(e=>{
      Badge.showError(e).then(() => {
        Badge.sleep();
      });
    });
  } else {
    let buttonPressed = ESP32.getWakeupPin();
    if (buttonPressed == BTN1) {
      log("Button 1 -> display? (check if BTN2 pressed?)");
      Badge.setLEDs("#0f0600");
      let pauseTime = getTime()+1;
      let btn2Pressed = false;
      while (getTime() < pauseTime && !btn2Pressed)
        btn2Pressed |= BTN2.read();
      if (!btn2Pressed) {
        btn1Pressed(BTN1.read()); // still held after the 1s wait = long press
        return;
      } else {
        buttonPressed = BTN2;
      }
    }
    if (buttonPressed == BTN2) {
      btn2Pressed();
    } else { // just turned on...
       log("No button pressed");
       if (require("Storage").read("showing") != "badge") {
         log("Show badge");
         showBadge().then(() => Badge.sleep());
       } else {
         log("Sleep after 10s");
         Badge.setLEDs("#111");
         let arr = new Uint24Array(Badge.led_rgb.buffer);
         let count = 0, brightness = 16, btn2Count = 0;
         let anim = setInterval(function() {
          if (BTN2.read() && !BTN1.read()) { // if BTN2 held for a bit, center connectable mode
            btn2Count++;
            if (btn2Count>8) {
              clearInterval(anim);
              return setConnectableMode();
            }
          } else btn2Count=0;
          brightness --;
          arr[count] = brightness|(brightness<<8)|(brightness<<16);
          arr[9-count] = brightness|(brightness<<8)|(brightness<<16);
          if (brightness<=0) {
            brightness=16;
            count++;
          }
          Badge.setLEDArray();
          if (count>4) {
            Badge.setLEDs("#fff");
            clearInterval(anim);
            if (BTN1.read() && BTN2.read()) {
              console.log("Factory Reset");
              Badge.setLEDs("#f0f");
              setTimeout(function() {
                if (require("Storage").read("pair.epaper")!==undefined) { // if we have pairing, show it
                  Badge.showImageFile("pair.epaper").then(() => {
                    require("Storage").write("showing", "pair");
                    setTimeout(load,100);
                    factoryReset();
                  });
                } else {
                  setTimeout(load,100);
                  factoryReset();
                }
              }, 1000);
            } else
              Badge.sleep();
          }
         }, 125);
       }
    }
  }
}


/// Dump all the business cards that were scanned
function dumpScans() {
  var f = require("Storage").open("scans.txt","r");
  var l = f.readLine();
  while (l) {
    print(l.trim());
    l = f.readLine();
  }
}

/// Erase everything apart from program code and pairing epaper screens
function factoryReset() {
  require("Storage").list().filter(d=>!([".bootcde","wifi.json","pair.epaper","connect.epaper","showing","app.info"].includes(d))).forEach(f=>require("Storage").erase(f));
  require("Storage").compact();
}
/*
Badge.sleep = function() {
  log("DEBUG> sleep called");
  Badge.setLEDs();
  let b1Watch = setWatch(function() {
    tidy();
    btn1Pressed();
  }, BTN1);
  let b2Watch = setWatch(function() {
    tidy();
    btn2Pressed();
  }, BTN2);
  function tidy() {
    clearWatch(b1Watch);
    clearWatch(b2Watch);
    b1Watch = b2Watch = undefined;
  }
};*/
startup();

