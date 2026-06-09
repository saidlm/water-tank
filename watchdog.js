/************************************************
 * Shelly 2PM Gen4 -> Domoticz MQTT bridge
 * Watch dog
 * Ver 2.0
 ************************************************/

const MIN_LEVEL_PERCENT = 5;
const PUMP_RUNTIME_MS = 15 * 60 * 1000;
const PROTECTION_CHECK_MS = 2000;
const BLOWER_RUNTIME_MS = 15 * 60 * 1000;

/************************************************
 * Internal global variables
 ************************************************/
let pumpStartTime = null;
let blowerStartTime = null;

/************************************************
 * Pump protection
 ************************************************/
function stopPump(reason) {
  
  Shelly.call("Switch.Set", {
    id: 0,
    on: false
  });
  
  pumpStartTime = null;

  print("Pump STOP:", reason);
}

function checkPumpTimeout(status) {

  let pumpOn =
    status["switch:0"] &&
    status["switch:0"].output === true;

  if (!pumpOn) {
    pumpStartTime = null;
    return;
  }

  if (pumpStartTime === null) {
    pumpStartTime = Shelly.getUptimeMs();
    return;
  }

  if (Shelly.getUptimeMs() - pumpStartTime > PUMP_RUNTIME_MS) {

    stopPump("timeout");
  }
}

function checkWaterLevel(status) {

  let pumpOn =
    status["switch:0"] &&
    status["switch:0"].output === true;

  if (!pumpOn) {
    return;
  }
  
  if (status["input:100"] && status["input:100"].percent !== undefined) {
    let percent = status["input:100"].percent;
    print("Water level check:", percent);

      if (percent < MIN_LEVEL_PERCENT) {
        stopPump("low water level");
      }
    }
    else {
      stopPump("unknown water level value");
    }
}

/************************************************
 * Blower protection
 ************************************************/
function stopBlower(reason) {

  Shelly.call("Switch.Set", {
    id: 1,
    on: false
  });
  
  blowerStartTime = null;

  print("Blower STOP:", reason);
}

function checkBlowerTimeout(status) {

  let blowerOn =
    status["switch:1"] &&
    status["switch:1"].output === true;

  if (!blowerOn) {
    blowerStartTime = null;
    return;
  }

  if (blowerStartTime === null) {
    blowerStartTime = Shelly.getUptimeMs();
    return;
  }

  if (Shelly.getUptimeMs() - blowerStartTime > BLOWER_RUNTIME_MS) {

    stopBlower("timeout");
  }
}

function watchDog() {
  
  
  Shelly.call("Shelly.GetStatus", {}, function(res, err) {

    if (err || !res) {
      return;
    }
  
    checkWaterLevel(res);
    checkPumpTimeout(res);
    checkBlowerTimeout(res);
  });
}
  
/************************************************
 * Startup
 ************************************************/

stopPump("startup reset");
stopBlower("startup reset");

Timer.set(PROTECTION_CHECK_MS, true, watchDog);

print("Watch dog started");
