/************************************************
 * Shelly 2PM Gen4 -> Domoticz MQTT bridge
 * MQTT Bridge
 * Ver 2.0
 ************************************************/

let DEVICE_NAME = "Vodojem";
let DEVICE_ID = "";
let BASE_TOPIC = "vodojem";
let DISCOVERY_PREFIX = "homeassistant";

const PERIODIC_MQTTUPDATE = 5 * 60 * 1000;

/************************************************
 * Internal global variables
 ************************************************/
 
let lastAnalog = -1;
let lastTemperature = -100;
let mqttSubscribed = false;
let mqttReadyTimer1 = null;
let mqttReadyTimer2 = null;
let discoveryRunning = false;
let discoveryPublished = false;

/************************************************
 * Helper functions
 ************************************************/

function topic(path) {

  return BASE_TOPIC + "/" + path;
}

function discoveryTopic(component, objectId) {

  return DISCOVERY_PREFIX + "/" +
         component + "/" +
         objectId + "/config";
}

function scheduleDiscovery(delay) {

  if (discoveryRunning) return;
  discoveryRunning = true;

  Timer.set(delay || 5000, false, function () {

    Shelly.call("MQTT.GetStatus", {}, function (res, err) {

      if (!res || err || !res.connected || !DEVICE_ID) {
        print("Discovery postponed");
        discoveryRunning = false;
        scheduleDiscovery(Math.min((delay || 5000) * 2, 60000));
        return;
      }

      publishHADiscovery();
      discoveryRunning = false;
      discoveryPublished = true;
    });
  });
}

function mqttPublish(path, payload, retain) { 
  MQTT.publish( 
    topic(path), 
    payload, 
    0, 
    retain || false 
  ); 
}

function mqttPublishDiscovery(component, objectId, payload) {

  MQTT.publish(
    discoveryTopic(component, objectId),
    JSON.stringify(payload),
    0,
    true
  );
}

function sendTemp(temp) {

  if (temp === null || temp === undefined) {
    print("Temperature value not ready");
    return;
  }
  
  lastTemperature = temp;
  mqttPublish("temperature", temp.toString(), true);
}

function sendAnalog(percent) {

  if (percent === null || percent === undefined) {
    print("Analog value not ready");
    return;
  }

  lastAnalog = percent;
  mqttPublish("analog", percent.toFixed(1), true);
}

function sendRelay(id, state) {

  mqttPublish("relay/" + id + "/state", state ? "ON" : "OFF", true);
}

function sendInput(id, state) {

  mqttPublish("input/" + id, state ? "ON" : "OFF", true);
}

/************************************************
 * Publish sensors, inputs and relay
 ************************************************/

function publishRelayStates() {

  Shelly.call("Shelly.GetStatus", {}, function (res, err) {

    if (err || !res) {
      print("Relay status read error");
      return;
    }

    if (res["switch:0"] &&
        res["switch:0"].output !== undefined) {

      sendRelay("0", res["switch:0"].output);
    }

    if (res["switch:1"] &&
        res["switch:1"].output !== undefined) {

      sendRelay("1", res["switch:1"].output);
    }
  });
}

function publishInputStates() {

  Shelly.call("Shelly.GetStatus", {}, function (res, err) {

    if (err || !res) {
      print("Input status read error");
      return;
    }

    if (res["input:0"] &&
        res["input:0"].state !== undefined) {

      sendInput("0", res["input:0"].state);
    }

    if (res["input:1"] &&
        res["input:1"].state !== undefined) {

      sendInput("1", res["input:1"].state);
    }
  });
}

function publishSensors() {

  Shelly.call("Shelly.GetStatus", {}, function (res, err) {

      if (err) {
        print("Status read error");
        return;
      }

      /******************************************
       * Temperature DS18B20
       ******************************************/

      if (res["temperature:100"] && res["temperature:100"].tC !== undefined && res["temperature:100"].tC !== null) {
        let temp = res["temperature:100"].tC;
        print("Temperature:", temp);
        sendTemp(temp);
      }

      /******************************************
       * Analog input %
       ******************************************/

      if (res["input:100"] && res["input:100"].percent !== undefined && res["input:100"].percent !== null) {
        let percent = res["input:100"].percent;
        print("Analog percent:", percent);
        sendAnalog(percent);
      }
      else {
        let percent = 100;
        print("Analog percent:", percent);
        sendAnalog(percent);
      }
    }
  );
}

/********************************************
 * HA Discovery
 ********************************************/
   
function publishHADiscovery(done) {

  let items = [
    ["sensor", DEVICE_ID + "_temperature", { name: DEVICE_NAME + " Temperature", unique_id: DEVICE_ID + "_temperature", stat_t: topic("temperature"), unit_of_meas: "°C", dev_cla: "temperature", stat_cla: "measurement" }],
    ["sensor", DEVICE_ID + "_analog", { name: DEVICE_NAME + " Water level", unique_id: DEVICE_ID + "_analog", stat_t: topic("analog"), unit_of_meas: "%", stat_cla: "measurement" }],
    ["binary_sensor", DEVICE_ID + "_input_0", { name: DEVICE_NAME + " Button", unique_id: DEVICE_ID + "_input_0", stat_t: topic("input/0"), pl_on: "ON", pl_off: "OFF" }],
    //["binary_sensor", DEVICE_ID + "_input_1", { name: DEVICE_NAME + " Input 2", unique_id: DEVICE_ID + "_input_1", stat_t: topic("input/1"), pl_on: "ON", pl_off: "OFF", device_class: "opening" }],
    ["switch", DEVICE_ID + "_relay_0", { name: DEVICE_NAME + " Pump", unique_id: DEVICE_ID + "_relay_0", stat_t: topic("relay/0/state"), cmd_t: topic("relay/0/set"), pl_on: "ON", pl_off: "OFF" }],
    ["switch", DEVICE_ID + "_relay_1", { name: DEVICE_NAME + " Blower", unique_id: DEVICE_ID + "_relay_1", stat_t: topic("relay/1/state"), cmd_t: topic("relay/1/set"), pl_on: "ON", pl_off: "OFF" }]
  ];

  let i = 0;

  function sendNext() {
    
    if (i >= items.length) {
      return;
    }

    let item = items[i++];
    mqttPublishDiscovery(item[0], item[1], item[2]);
    Timer.set(200, false, sendNext);
  }

  sendNext();
 
  print("MQTT discovery published");
}

/************************************************
 * MQTT subscriptions
 ************************************************/

function mqttSubscribe() {

  if (mqttSubscribed) {
    return;
  }

  MQTT.subscribe(topic("relay/0/set"), function(topic, msg) {

    Shelly.call("Switch.Set", {
      id: 0,
      on: (msg || "").toUpperCase() === "ON"
    });
  });

  MQTT.subscribe(topic("relay/1/set"), function(topic, msg) {

    Shelly.call("Switch.Set", {
      id: 1,
      on: (msg || "").toUpperCase() === "ON"
    });
  });

  mqttSubscribed = true;

  print("MQTT subscribe active");
}
  
/************************************************
 * Periodic sensor updates
 ************************************************/

function startPeriodicUpdate(interval) {
  Timer.set(interval, true, function () {

      publishSensors();
    }
  );
}

/************************************************
 * MQTT initial communication
 ************************************************/
function onMQTTReady() {

  print("MQTT READY");

  mqttSubscribe();
  
  if (!discoveryPublished) {
    scheduleDiscovery();
  }

  publishRelayStates();
 
  if (mqttReadyTimer1) {
    Timer.clear(mqttReadyTimer1);
  }

  if (mqttReadyTimer2) {
    Timer.clear(mqttReadyTimer2);
  }
  
  mqttReadyTimer1 = Timer.set(200, false, function () {
    mqttReadyTimer1 = null;
    publishInputStates();
  });

  mqttReadyTimer2 = Timer.set(400, false, function () {
    mqttReadyTimer2 = null;
    publishSensors();
  });
}

/************************************************
 * Input and relay event handling
 ************************************************/
function startEventAndStatusHandler() {

  Shelly.addStatusHandler(function(e) {
    
    if (!e || !e.component || !e.delta) return;

    // -----------------------
    // MQTT connected
    // -----------------------
    if (e.component === "mqtt" && e.delta && e.delta.connected === true) {
      print("MQTT connected");
      mqttSubscribed = false;
      onMQTTReady();
      return;
    }

    // -----------------------
    // RELAY state change
    // -----------------------
    if (e.component.indexOf("switch:") === 0) {
      let id = e.component.split(":")[1];
      let output = e.delta.output;
      if (output !== undefined) {               
        sendRelay(id, output);
        print("Relay", id, output);
      }
      return;
    }

    // -----------------------
    // INPUT state change
    // -----------------------
    if (e.component.indexOf("input:") === 0) {
      let id = e.component.split(":")[1];
      let state = e.delta.state;
      if (state !== undefined) {
        sendInput(id, state);
        print("Input", id, state);
      }
      return;
    }

    // -----------------------
    // ANALOG / TEMPERATURE (optional)
    // -----------------------
    if (e.component === "input:100" && e.delta.percent !== undefined) {
      let percent = e.delta.percent;

      if (Math.abs(percent - lastAnalog) < 0.5) 
        return;
         
      sendAnalog(percent);
      print("Analog", percent);
      return;
    }

    if (e.component === "temperature:100" && e.delta.tC !== undefined) {
      let temp = e.delta.tC;

      if (Math.abs(temp - lastTemperature) < 0.5)
        return;
        
      sendTemp(temp);
      print("Temperature", temp);
      return;
    }

  });
}

/************************************************
 * Startup
 ************************************************/

Shelly.call("Shelly.GetDeviceInfo", {}, function(res) {

  DEVICE_ID = res.id;
  print("Device ready:", DEVICE_ID);

  startPeriodicUpdate(PERIODIC_MQTTUPDATE);
  startEventAndStatusHandler();
  onMQTTReady();
});

print("Shelly Domoticz bridge started");
