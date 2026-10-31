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

// Set pixels c0..c1 (inclusive) of the 200-byte row at offset o to white (2-bit value 1).
function wipe(u8, o, c0, c1) {
  if (c0>c1) return;
  let b0 = c0>>2, b1 = c1>>2;
  let m0 = 0xFF>>((c0&3)*2), m1 = (0xFF<<((3-(c1&3))*2))&0xFF;
  if (b0==b1) {
    let m = m0&m1;
    u8[o+b0] = (u8[o+b0]&~m)|(0x55&m);
    return;
  }
  u8[o+b0] = (u8[o+b0]&~m0)|(0x55&m0);
  if (b1-b0>1) u8.fill(0x55, o+b0+1, o+b1);
  u8[o+b1] = (u8[o+b1]&~m1)|(0x55&m1);
}

// Whiten everything outside the boxes in one image row. Row x of the file is portrait
// column x; pixel c of the row is portrait y = 799-c.
function cleanRow(u8, o, x) {
  let y = 0;
  BOXES.forEach(function(b) {
    if (x<b[0] || x>b[1]) return;
    let r = b[4], d = Math.min(x-b[0], b[1]-x), ins = 0;
    if (d<r) ins = r-Math.round(Math.sqrt(r*r-(r-d)*(r-d)));
    wipe(u8, o, 799-(b[2]+ins-1), 799-y); // gap above this box
    y = b[3]-ins+1;
  });
  wipe(u8, o, 0, 799-y); // gap below the last box
}

// Draw QR (call with g already rotated). dx shifts x so the 48px-wide band that
// starts at screen column X can be drawn with dx=-X; drawing is clipped to the band.
function drawQR(g, dx) {
  let size = (QR_N+2*QR_MARGIN)*QR_SCALE;
  let x0 = ((480-size)>>1) + dx;
  g.setColor(1).fillRect(x0, QR_Y, x0+size-1, QR_Y+size-1); // white
  g.setColor(0); // black
  x0 += QR_MARGIN*QR_SCALE;
  let y0 = QR_Y + QR_MARGIN*QR_SCALE;
  for (let r=0;r<QR_N;r++)
    for (let c=0;c<QR_N;c++)
      if ((QR_DATA.charCodeAt(r*QR_STRIDE+(c>>3))>>(7-(c&7)))&1)
        g.fillRect(x0+c*QR_SCALE, y0+r*QR_SCALE, x0+(c+1)*QR_SCALE-1, y0+(r+1)*QR_SCALE-1);
}

// Badge.showImageFileRendering only lets the callback touch the first 48 rows (the left
// 48px strip in portrait). This streams the whole image in 48-row bands instead, calling
// cb(g, dx) per band, where dx is the x shift for that band (portrait coords, rotation 1).
function renderBadge(cb) {
  return Badge.showRaw(function(eD, resolve) {
    try {
      let img = require("Storage").read("badge.epaper");
      if (!img) throw new Error("badge.epaper not found");
      let g = Graphics.createArrayBuffer(800,48,2);
      let px = new Uint8Array(g.buffer);
      for (let y=0;y<480;y+=48) {
        g.setRotation(0);
        g.setBgColor(1).setColor(0);
        px.set(img.substr(y*200, 9600));
        for (let r=0;r<48;r++) cleanRow(px, r*200, y+r);
        g.setRotation(1);
        cb(g, -y);
        eD(g.buffer);
      }
    } catch (e) { log(e); }
    resolve();
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
    let img = atob("ICOBAAABgAAAD/AAAB/4AAA//AAAf/4AAH/+AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAAf/4AAH/+AAA//AAAH/gAAB/4AAAf+AAAH/gAAB/4AAB//gAB//+AB///4B////g////8f////n////7/////////////////////");
    //g.setBgColor(1).clearRect(0,735,47,799);
    g.setColor(0).drawImage(img, 24-16+dx, 759);
    g.setFont("22").setFontAlign(0,0).drawString(connectionCount, 24+dx,745);
    drawQR(g, dx);
  }).then(() => require("Storage").write("showing", "badge"));
}

function showProgrammme() {
  Badge.setLEDs("#730");
  return Badge.showImageFile("programme.epaper").then(() => require("Storage").write("showing", "programme"));
}

function btn1Pressed() {
  log("Button 1 -> display");
  if (require("Storage").read("showing") == "badge")
    showProgrammme().then(() => Badge.sleep());
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
        btn1Pressed();
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

