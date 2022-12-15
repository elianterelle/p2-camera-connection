import { P2CameraConnection } from ".";

export class CamCtlCommands {
    constructor(private p2: P2CameraConnection) { }

    public setTally(color: 'RED'|'GREEN', state: boolean) {
        this.sendRaw(`$${color == 'RED' ? 'R' : 'G'}TlySw:=${state ? 'On' : 'Off'}`);
    }

    public changeMasterGain(change: -1|1) {
        this.sendRaw(`$MGain:${this.numberToSignedString(change)}`);
    }

    public setColorBars(state: boolean) {
        this.sendRaw(`$BarSw:=${state ? 'On' : 'Off'}`);
    }

    public setIris(value: number) {
        this.sendRaw(`$Irs:=${value}`);
    }

    public changeIris(change: number) {
        const cState = this.p2.getCameraState();

        if (!cState) return;

        this.setIris(cState.iris + change);
    }

    public setWhiteBalanceChannel(channel: 'A' | 'B' | 'Preset') {
        this.sendRaw(`$WBalSel:=${channel}`);
    }

    public setGain(color: 'R' | 'B', value: number) {
        this.sendRaw(`$${color}Gain:=${value}`);
    }

    public changeGain(color: 'R' | 'B', change: number) {
        this.sendRaw(`$${color}Gain:${this.numberToSignedString(change)}`);
    }

    public setPedestal(color: 'R' | 'G' | 'B', value: number) {
        this.sendRaw(`$${color}Ped:=${value}`);
    }

    public changePedestal(color: 'R' | 'G' | 'B', change: number) {
        this.sendRaw(`$${color}Ped:${this.numberToSignedString(change)}`);
    }

    public setScreenOverlayDisplay(output: 1 | 2, state: boolean) {
        this.sendRaw(`$DispOut${output}:=${state ? 'On' : 'Off'}`);
    }

    public toggleScreenOverlayDisplay(output: 1 | 2) {
        this.sendRaw(`$DispOut${output}:=OnOff`);
    }

    public setMenu(state: boolean) {
        this.sendRaw(`$Menu:=${state ? 'On' : 'Off'}`);
    }

    public toggleMenu() {
        this.sendRaw(`$Menu:=OnOff`);
    }

    public sendMenuCommand(command: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SET' | 'EXIT') {
        const cmd = {
            UP: 'Up',
            DOWN: 'Dwn',
            LEFT: 'Lft',
            RIGHT: 'Rgt',
            SET: 'Set',
            EXIT: 'Bak'
        }[command];

        this.sendRaw(`$Menu${cmd}:t`);
    }

    public changeFocus(change: 1 | -1) {
        this.sendRaw(`$FcStep:${this.numberToSignedString(change)}`);
    }

    public changeZoom(change: 1 | -1) {
        this.sendRaw(`$ZmStep:${this.numberToSignedString(change)}`);
    }

    public setFocusSpeed(value: number) {
        this.sendRaw(`$FcSpd:=${value}`);
    }

    public setZoomSpeed(value: number) {
        this.sendRaw(`$ZmSpd:=${value}`);
    }

    public sendRaw(cmd: string) {
        this.p2.sendP2Control(`<CamCtl>${cmd}</CamCtl>`);
    }

    private numberToSignedString(value: number): string {
        if (value > 0) {
            return `+${value}`;
        }

        return value.toString();
    }
}