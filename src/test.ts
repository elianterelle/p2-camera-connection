import { P2CameraConnection } from ".";

console.log("start")
const con = new P2CameraConnection('10.1.2.154', 59152, 'A', 'ABCABCABC');
con.on('connected', () => {
    console.log("connected")
});
con.on('log', (s) => {
    console.log(s);
});
con.on('error', (s) => {
    console.log(s);
});
con.connect();
/*
0a 21 80 01
00 00 02 02
00 00 00 02
00 00 00 00
00 10 00 00
00 00 00 00
00 00 0f 0b
00 00 00 00
01 00 00
*/