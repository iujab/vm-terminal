import { spawn, ChildProcess } from 'child_process';
import { DisplayStack, getConfig } from './types';
import * as vscode from 'vscode';

export class DisplayManager {
  private outputChannel: vscode.OutputChannel;
  private displayStacks: Map<number, DisplayStack> = new Map();
  private usedDisplayNumbers: Set<number> = new Set();

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] DisplayManager: ${message}`);
  }

  allocateDisplayNumber(): number {
    const config = getConfig();
    let displayNum = config.baseDisplayNumber;
    while (this.usedDisplayNumbers.has(displayNum)) {
      displayNum++;
    }
    this.usedDisplayNumbers.add(displayNum);
    return displayNum;
  }

  releaseDisplayNumber(displayNumber: number): void {
    this.usedDisplayNumbers.delete(displayNumber);
  }

  async startDisplayStack(displayNumber: number): Promise<DisplayStack> {
    const config = getConfig();
    const offset = displayNumber - config.baseDisplayNumber;
    const vncPort = config.baseVncPort + offset;
    const websocketPort = config.baseWebsocketPort + offset;

    this.log(`Starting display stack: :${displayNumber}, VNC:${vncPort}, WS:${websocketPort}`);

    const stack: DisplayStack = {
      displayNumber,
      vncPort,
      websocketPort,
      isReady: false,
    };

    try {
      stack.xvfbProcess = await this.startXvfb(displayNumber);
      await this.sleep(500);
      stack.x11vncProcess = await this.startX11vnc(displayNumber, vncPort);
      await this.sleep(300);
      stack.websockifyProcess = await this.startWebsockify(websocketPort, vncPort);

      stack.isReady = true;
      this.displayStacks.set(displayNumber, stack);
      this.log(`Display stack :${displayNumber} started successfully`);

      return stack;
    } catch (error) {
      this.log(`Error starting display stack :${displayNumber}: ${error}`);
      this.cleanupStack(stack);
      throw error;
    }
  }

  stopDisplayStack(displayNumber: number): void {
    const stack = this.displayStacks.get(displayNumber);
    if (stack) {
      this.log(`Stopping display stack :${displayNumber}`);
      this.cleanupStack(stack);
      this.displayStacks.delete(displayNumber);
      this.releaseDisplayNumber(displayNumber);
    }
  }

  getDisplayStack(displayNumber: number): DisplayStack | undefined {
    return this.displayStacks.get(displayNumber);
  }

  private async startXvfb(displayNumber: number): Promise<ChildProcess> {
    this.log(`Starting Xvfb on :${displayNumber}`);

    const xvfb = spawn('Xvfb', [
      `:${displayNumber}`,
      '-screen', '0', '1280x720x24',
      '-ac',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    xvfb.on('error', (err) => {
      this.log(`Xvfb :${displayNumber} error: ${err.message}`);
    });

    xvfb.on('exit', (code) => {
      this.log(`Xvfb :${displayNumber} exited with code ${code}`);
    });

    return xvfb;
  }

  private async startX11vnc(displayNumber: number, vncPort: number): Promise<ChildProcess> {
    this.log(`Starting x11vnc for :${displayNumber} on port ${vncPort}`);

    // Remove Wayland env vars to prevent detection issues
    const env = { ...process.env };
    delete env.WAYLAND_DISPLAY;
    delete env.XDG_SESSION_TYPE;

    const x11vnc = spawn('x11vnc', [
      '-display', `:${displayNumber}`,
      '-rfbport', vncPort.toString(),
      '-forever',
      '-shared',
      '-nopw',
      '-noxdamage',
      '-wait', '5',
      '-defer', '5',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    x11vnc.on('error', (err) => {
      this.log(`x11vnc :${displayNumber} error: ${err.message}`);
    });

    x11vnc.on('exit', (code) => {
      this.log(`x11vnc :${displayNumber} exited with code ${code}`);
    });

    return x11vnc;
  }

  private async startWebsockify(websocketPort: number, vncPort: number): Promise<ChildProcess> {
    this.log(`Starting websockify on port ${websocketPort} -> VNC ${vncPort}`);

    const websockify = spawn('websockify', [
      websocketPort.toString(),
      `localhost:${vncPort}`,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    websockify.on('error', (err) => {
      this.log(`websockify :${websocketPort} error: ${err.message}`);
    });

    websockify.on('exit', (code) => {
      this.log(`websockify :${websocketPort} exited with code ${code}`);
    });

    return websockify;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private killProcess(proc: ChildProcess | undefined, name: string): void {
    if (!proc) return;
    try {
      if (proc.pid && !proc.killed) {
        this.log(`Killing ${name} (PID: ${proc.pid})`);
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 2000);
      }
    } catch (err) {
      this.log(`Error killing ${name}: ${err}`);
    }
  }

  private cleanupStack(stack: DisplayStack): void {
    this.killProcess(stack.websockifyProcess, `websockify:${stack.websocketPort}`);
    this.killProcess(stack.x11vncProcess, `x11vnc:${stack.displayNumber}`);
    this.killProcess(stack.xvfbProcess, `Xvfb:${stack.displayNumber}`);
    stack.isReady = false;
  }

  dispose(): void {
    this.log('Disposing DisplayManager - cleaning up all display stacks');
    for (const [displayNumber] of this.displayStacks) {
      this.stopDisplayStack(displayNumber);
    }
  }
}
