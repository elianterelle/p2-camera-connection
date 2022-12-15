import * as net from 'net';
import * as xml2js from 'xml2js';
import * as crypto from 'crypto';
import * as udp from 'dgram';
import { EventEmitter } from 'eventemitter3';

export { CamCtlCommands } from './camCtl'; 
import { CamCtlCommands } from './camCtl';

export class P2CameraConnection extends EventEmitter<P2Events> {
    private tcpClient: net.Socket;
    private udpClient: any = null;

    private tcpConnectionState: TcpConnectionState = TcpConnectionState.Disconnected;

    private authToken: string | null = null;
    private sessionID: string | null = null;
    private envInfo: P2EnvInfo | null = null;

    private opticalState: P2OpticalState | null = null;
    private cameraState: P2CameraState | null = null;

    public camCtl: CamCtlCommands;

    constructor(
        private host: string,
        private port: number,
        private username: string,
        private password: string,
        private reconnectInterval: number = 100
    ) {
        super();
        
        this.camCtl = new CamCtlCommands(this);

        this.tcpClient = new net.Socket();
        this.tcpClient.on('data', (xml: string) => this.onTcpData(xml.toString()));
        this.tcpClient.on('connect', () => this.onTcpConnected());
        this.tcpClient.on('close', () => {
            this.emit('log', `TCP Connection closed`);
            this.tcpConnectionState = TcpConnectionState.Disconnected;
            this.emit('disconnected');

            if (reconnectInterval === 0) {
                return;
            }

            this.emit('log', `Reconnecting in ${this.reconnectInterval}ms`);
            setTimeout(() => {
                this.connect();
            }, this.reconnectInterval)
        });

        this.tcpClient.on('error', (e) => {
            this.emit('log', `TCP Connection error: ${e}`);
        });
        
        setInterval(() => {
            this.pollInterval();
        }, 5000);
    }

    public connect() {
        if (this.tcpConnectionState === TcpConnectionState.Connected) {
            return;
        }

        this.emit('log', `Opening TCP Connection to ${this.host}:${this.port}`);
        this.emit('connecting');
        this.tcpClient.connect(this.port, this.host);
    }

    private connectUdp() {
        this.udpClient = udp.createSocket('udp4');

        this.udpClient.on('message', (msg: Buffer, info: UdpRInfo) => {
            this.onUdpData(msg, info);
        });

        try {
            this.udpClient.bind(this.envInfo?.udpPort);
            this.emit('log', `Opened UDP Socket on port ${this.envInfo?.udpPort}`);
        } catch (e) {
            this.emit('log', `Failed opening UDP Socket on port ${this.envInfo?.udpPort}: ${e}`);
            this.disconnect();
            return;
        }

        this.emit('log', `Connecting via UDP to ${this.host}:${this.envInfo?.udpPort}`);
        this.pollUdp();
    }

    public disconnect() {
        this.sendP2Control(`<CamCtl>$Connect:=Off</CamCtl>`);
        this.udpClient.close();
        this.tcpClient.destroy();
        this.udpClient = null;
        this.tcpConnectionState = TcpConnectionState.Disconnected;
    }

    public sendP2Control(data: string) {
        const authXml = this.authToken ? `<Auth>${this.authToken}</Auth>` : '';
        const xml = `<P2Control>${authXml}<SessionID>${this.sessionID ?? ''}</SessionID>${data}</P2Control>`.replace(/(\r\n|\n|\r)/gm, '');

        if (!this.tcpClient) {
            this.emit('debug', "TCP Client not connected, skipping send.");
            return;
        }

        this.tcpClient.write(xml);
        
        this.emit('debug', "Sent XMl: " + xml);
    }

    private pollInterval() {
        if (this.tcpConnectionState === TcpConnectionState.Connected) {
            this.sendP2Control(`<CamCtl>$KpAlive:?</CamCtl>`);

            if (this.udpClient) {
                this.pollUdp();
            }
        }
    }

    private pollUdp() {
        const pollData = Buffer.from([0xff, 0x01, 0xff]);
        this.udpClient.send(pollData, this.envInfo?.udpPort, this.host, (error: any) => {
            if (!error) {
                return;
            }

            this.emit('error', `UDP Polling ${this.host}:${this.envInfo?.udpPort} failed: ${error}`);
        });
    }

    private onUdpData(data: Buffer, info: UdpRInfo) {
        // ignore data from other cameras
        if (info.address !== this.host) {
            return;
        }

        const type: UdpNotificationType = data[0];

        if (type === UdpNotificationType.OpticalSetting) {
            this.onUdpOpticalSetting(data);
        }
        if (type === UdpNotificationType.CameraStatus) {
            this.onUdpCameraStatus(data);
        }
    }

    private onUdpCameraStatus(data: Buffer) {
        const whiteBalanceChannel: Camera.WhiteBalanceChannel = data.subarray(11, 12).readUint8();
        const redGain: number = data.subarray(12, 14).readInt16BE();
        const blueGain: number = data.subarray(14, 16).readInt16BE();
        const masterPedestal: number = data.subarray(16, 18).readInt16BE();
        const redPedestal: number = data.subarray(18, 20).readInt16BE();
        const greenPedestal: number = data.subarray(20, 22).readInt16BE();
        const bluePedestal: number = data.subarray(22, 24).readInt16BE();
        const iris: number = data.subarray(26, 28).readUInt16BE();

        this.cameraState = {
            whiteBalanceChannel,
            redGain,
            blueGain,
            masterPedestal,
            redPedestal,
            greenPedestal,
            bluePedestal,
            iris
        };

        this.emit('cameraState', this.cameraState);
    }

    private onUdpOpticalSetting(data: Buffer) {
        const irisBuffer = data.subarray(8, 10);
        let iris: number | 'OPEN' | 'CLOSE' = irisBuffer.readUint16BE()/10;
        if (iris == 0) iris = 'OPEN';
        if (iris == 6553.5) iris = 'CLOSE';

        const focus = this.bufToFloat(data.subarray(10, 12), 2); // focus in Meters, 2 decimal places
        const zoom = Math.round(this.bufToFloat(data.subarray(12, 14), 4) * 10000) / 10; // zoom in Millimeters, 1 decimal place
        const lensModel = data.subarray(14, 44).toString();

        const masterGainBuffer = data.subarray(44, 46);


        const shutterSpeedInteger = data.subarray(46, 48).readUint16BE();
        const shutterSpeedDecimal = data.subarray(49, 50).readUint8();

        let shutterModeInt = data.subarray(48, 49).readUint8();
        if (shutterModeInt == 6) shutterModeInt = 3;

        const shutterMode: Optical.ShutterMode = shutterModeInt;

        let shutter = '?';
        let shutterUnit = '?';

        switch (shutterMode) {
            case Optical.ShutterMode.FixedCommonFraction:
                shutter = `1/${shutterSpeedInteger}`;
                shutterUnit = 's';
                break;
            
            case Optical.ShutterMode.FixedCommonFraction:
                shutter = `${shutterSpeedInteger}.${shutterSpeedDecimal}`;
                shutterUnit = 'deg';
                break;
                
            case Optical.ShutterMode.SynchroCommonFraction:
            case Optical.ShutterMode.StaticNumerator:
                shutter = `1/${shutterSpeedInteger}.${shutterSpeedDecimal}`;
                shutterUnit = 's';
                break;
        
            case Optical.ShutterMode.SynchroDecimal:
                shutter = `${shutterSpeedInteger}.${shutterSpeedDecimal}`;
                shutterUnit = 'deg';
                break;
        }

        const gamma: Optical.Gamma = data.subarray(50, 51).readUint8();

        const byte5253 = data.subarray(52, 54).readUint16BE();
        const byte62 = data.subarray(62, 63).readUint8();

        const atw: Optical.ATW = this.getBitsInt(byte5253, 8+6, 8+7);
        const colorTemperatureMag: number = this.getBitsInt(byte62, 0, 0) == 1 ? 100 : 10;
        const colorTemperature: number = this.getBitsInt(byte5253, 0, 8+3) * colorTemperatureMag;
        const colorTemperatureState: Optical.ColorTemperatureState = this.getBitsInt(byte5253, 8+4, 8+5);

        const byte57 = data.subarray(57, 58).readUint8();
        const ndFilterMode = this.getBitsInt(byte57, 0, 0);
        const ndFilterInteger = data.subarray(54, 55).readUint8();
        const ndFilter = ndFilterMode == 1 ? ndFilterInteger/100 : `1/${ndFilterInteger}`;

        const colorCorrectionFilter = data.subarray(55, 56).readUint8();

        const autoGainControl: boolean = this.getBitsInt(byte57, 7, 7) == 1;
        const gainUnitInt = this.getBitsInt(byte57, 6, 6);

        const masterGainInteger = gainUnitInt == 1 ? masterGainBuffer.readUint16BE() : masterGainBuffer.readInt16BE();
        const masterGain = gainUnitInt == 1 ? `ISO${masterGainInteger*10}` : `${masterGainInteger}dB`;

        const rgGainEnabled: boolean = this.getBitsInt(byte57, 3, 3) == 0;

        const irisUnit = this.getBitsInt(byte57, 2, 2) == 1 ? 'F' : 'T';

        const frameRate = data.subarray(58, 60).readUint16BE()

        const awbEnabled: boolean = this.getBitsInt(byte62, 2, 2) == 1;

        const awbChannel = this.getBitsInt(byte62, 0, 0) == 1 ? 'B' : 'A';

        this.opticalState = {
            iris,
            focus,
            zoom,
            lensModel,
            shutter,
            shutterUnit,
            irisUnit,
            gamma,
            atw,
            awbEnabled,
            awbChannel,
            colorTemperature,
            colorTemperatureState,
            ndFilter,
            colorCorrectionFilter,
            autoGainControl,
            masterGain,
            rgGainEnabled,
            frameRate
        };

        this.emit('opticalState', this.opticalState);
    }

    public getCameraState(): P2CameraState | null{
        return this.cameraState;
    }

    public getOpticalState(): P2OpticalState | null {
        return this.opticalState;
    }

    private bufToFloat(buffer: Buffer, decimals: number) {
        const int = buffer.readUInt16BE();
        const sig = int & 0b111111111111;
        const exp = ((int & 0b1111000000000000) >> 12) - (16-decimals);
        return Math.round(sig * (10**exp)) / (10**decimals);
    }

    private getBitsInt(int: number, fromBit: number, toBit: number) {
        int = int >> fromBit;
        const mask = (1 << ((toBit - fromBit) + 1))-1;
        return int & mask;
    };

    private onTcpConnected() {
        this.emit('tcpConnected');
        this.sendP2Control(`<Login>${this.username}</Login>`);
        this.tcpConnectionState = TcpConnectionState.WaitForEncryptionKey;
    }

    private async onTcpData(xml: string) {
        this.emit('debug', "Received XMl: " + xml);
        const data = await xml2js.parseStringPromise(xml);
        const error = data.P2Control?.Error?.[0];

        if (error) {
            this.emit('error', error);
            return;
        }

        const response = data.P2Control?.Response?.[0];

        switch (this.tcpConnectionState) {
            case TcpConnectionState.WaitForEncryptionKey:
                if (!response?.Realm || !response?.Nonce) {
                    break;
                }

                this.onEncryptionKey(response.Realm[0], response.Nonce[0]);
                break;

            case TcpConnectionState.WaitForEnvInfo:
                if (!response?.Version) {
                    break;
                }

                this.onEnvInfo(response);
                break;

            case TcpConnectionState.WaitForSessionID:
                if (!data.P2Control?.CamCtl) {
                    break;
                }

                const sessionID = data.P2Control?.CamCtl?.[0]?.$?.SessionID;

                if (!sessionID) {
                    break;
                }

                this.onSessionID(sessionID);
                break;
        }
    }

    private onEncryptionKey(realm: string, nonce: string) {
        const innerAuthToken = this.md5(`${this.username}:${realm}:${this.password}`);
        this.authToken = this.md5(`${innerAuthToken}:${nonce}`);
        this.sendP2Control(`<Query Type="env"/>`);
        this.tcpConnectionState = TcpConnectionState.WaitForEnvInfo;
    }

    private onEnvInfo(response: any) {
        this.envInfo = {
            version: response.Version[0],
            udpPort: parseInt(response.RTInfo[0].Port),
            device: {
                manufacturer: response.Device[0].Manufacturer[0],
                modelName: response.Device[0].ModelName[0],
                serialNumber: response.Device[0]['SerialNo.'][0],
                additionalFunction: response.Device[0].AdditionalFunction[0],
                cmdTimeout: response.Device[0].CmdTimeout[0]
            }
        };

        this.emit('envInfo', this.envInfo);

        const rcName = {
            'HC-X2': 'RC_SemiProApp_NodeJS',
            'HC-X20': 'RC_SemiProApp_NodeJS',
            'CX350': 'RC_AllianceApp',
            'EVA1': 'RC_AllianceApp'
        }[this.envInfo.device.modelName] ?? 'RC_P2Package_NodeJS';

        this.sendP2Control(`<CamCtl>$Connect:=On</CamCtl><CamCtl>$MyName:s${rcName}</CamCtl>`);
        this.tcpConnectionState = TcpConnectionState.WaitForSessionID;
    }

    private onSessionID(sessionID: string) {
        this.sessionID = sessionID;
        this.tcpConnectionState = TcpConnectionState.Connected;
        this.emit('connected');
        this.connectUdp();
    }

    private md5(text: string) {
        return crypto.createHash('md5').update(text).digest("hex");
    }
}

enum TcpConnectionState {
    Disconnected,
    WaitForTCPConnection,
    WaitForEncryptionKey,
    WaitForEnvInfo,
    WaitForSessionID,
    Connected
}

enum UdpNotificationType {
    Event = 0x00,
    TimeCode = 0x01,
    MediaResidualQuantityP2Card = 0x02,
    PowerSupplyState = 0x03,
    AudioInformation = 0x04,
    OpticalSetting = 0x06,
    Status = 0x08,
    MediaResidualQuantityMicroP2CardAndTotal = 0x09,
    CameraStatus = 0x0A,
    StatusAndInformationChangeEvent = 0x0B
}

export namespace Optical {
    export enum ShutterMode {
        ShutterOff = 0,
        FixedCommonFraction = 1,
        SynchroCommonFraction = 3,
        Half = 4,
        SynchroDecimal = 5,
        StaticNumerator = 8
    }

    export enum Gamma {
        HD = 0,
        SD = 1,
        FILMLIKE1 = 2,
        FILMLIKE2 = 3,
        FILMLIKE3 = 4,
        FILMREC = 5,
        DFLT = 6,
        VIDEOREC = 7,
        CINELIKED = 8,
        CINELIKEV = 9,
        STILL = 10,
        HLG = 11,
        V255570L1 = 12,
        V504580L1 = 13,
        VIDEO = 14
    }

    export enum ATW {
        Invalid = 0,
        Valid = 1,
        ValidLock = 2
    }

    export enum ColorTemperatureState {
        Under = 0,
        Over = 1,
        Correct = 2
    }
}

export namespace Camera {
    export enum WhiteBalanceChannel {
        PRE = 0,
        A = 1,
        B = 2
    };
}

interface UdpRInfo {
    address: string;
    family: string;
    port: number;
    size: number;
}

export interface P2EnvInfo {
    version: string;
    udpPort: number;
    device: {
        manufacturer: string;
        modelName: string;
        serialNumber: string;
        additionalFunction: string;
        cmdTimeout: number;
    }
}

export interface P2OpticalState {
    iris: number | "OPEN" | "CLOSE";
    focus: number;
    zoom: number;
    lensModel: string;
    shutter: string;
    shutterUnit: string;
    irisUnit: 'F' | 'T';
    gamma: Optical.Gamma;
    atw: Optical.ATW;
    awbEnabled: boolean;
    awbChannel: 'A' | 'B';
    colorTemperature: number;
    colorTemperatureState: Optical.ColorTemperatureState;
    ndFilter: string | number;
    colorCorrectionFilter: number;
    autoGainControl: boolean;
    masterGain: string;
    rgGainEnabled: boolean;
    frameRate: number;
}

export interface P2CameraState {
    whiteBalanceChannel: Camera.WhiteBalanceChannel;
    redGain: number;
    blueGain: number;
    masterPedestal: number;
    redPedestal: number;
    greenPedestal: number;
    bluePedestal: number;
    iris: number;
}

export interface P2Events {
    opticalState: [P2OpticalState];
    cameraState: [P2CameraState];
    envInfo: [P2EnvInfo];
    connecting: [];
    tcpConnected: [];
    connected: [];
    disconnected: [];
    log: [any];
    debug: [any];
    error: [string];
}