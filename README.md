# P2 Camera Connection

This Library can be used to control Panasonic Cameras implementing the P2 Protocol. This was tested with the AG-CX350 and HC-X2, but according to Panasonics Documentation, which can be found at https://eww.pass.panasonic.co.jp/pro-av/support/content/guide/EN/top.html#P2 , this should work with the following devices:
- HPX3100 / HPX600 / HPX5000
- PX270 / PX800 / PX380
- Varicam35 / VaricamHS / VaricamLT
- EVA1
- CX Series
- HC-X2 (not mentioned in the documentation, probably as it was released afterwards, but tested working)

## Installation

This library can be installed using npm:
```sh
npm install p2-camera-connection
```

## Usage

```ts
import { P2CameraConnection } from "p2-camera-connection";

const connection = new P2CameraConnection('192.168.1.123', 49152, 'USERNAME', 'PASSWORD');

connection.on('debug', (message) => {
    // Debugging Information (Set Data, Received Data, ...)
    console.log('Debug', message);
});

connection.on('log', (message) => {
    // General Log Messages (Connection State, ...)
    console.log('Log', message);
});

connection.on('error', (message) => {
    // Error Messages(Connection, Errors returned from Camera)
    console.error(message);
});

connection.on('connecting', () => {
    console.log("Starting Connection")
});

connection.on('tcpConnected', () => {
    console.log("TCP Connection established")
    /*
    TCP Connection successfully established, the library
    will now try to authenticate to the Camera
    */
});

connection.on('connected', () => {
    console.log("Connected")
    /*
    Connection got accepted by the Camera
    */

   test();
});

connection.on('disconnected', () => {
    console.log("Disconnected")
});

connection.on('opticalState', (opticalState) => {
    console.log("Received Optical State", opticalState);
});

connection.on('envInfo', (envInfo) => {
    console.log("Received Env Info", envInfo);
    /*
    Info about the Camera Model, Serial Number,...
    */
});

connection.on('cameraState', (cameraState) => {
    console.log("Received Camera State", cameraState);
});

connection.connect();

function test() {
    // A few examples:
    connection.camCtl.setTally('GREEN', true); // set Green Tally
    connection.camCtl.setIris(4000); // set Iris (control value, doesn't correspond to the actual f-stop)
    connection.camCtl.changeZoom(-1); // Zoom out one step
    connection.camCtl.changeZoom(1); // Zoom in one step
}
```

## Documentation

Generated docs can be found [here](https://elianterelle.github.io/p2-camera-connection/).