import express from 'express';
import { GeneralRelayCounts, ServerController } from './server-controller';
import bindAll from 'lodash/bindAll';
import { Logger } from './logger';
import request from 'superagent';
import isNumber from 'lodash/isNumber';
import { Gateway } from '../interfaces';
import { timeout } from '../util';
import fs from 'fs-extra';
import path from 'path';

export class ControlServer {

  static routes = {
    VERSION: '/v1/version',
    DRAIN_GENERAL_RELAY_COUNTS: '/v1/drain-general-relay-counts',
    DRAIN_HOST_RELAY_COUNTS: '/v1/drain-host-relay-counts',
    RELOAD: '/v1/reload',
    REBUILD: '/v1/rebuild',
    RESTART: '/v1/restart',
    SHUTDOWN: '/v1/shutdown',
  }

  _port: number;
  _serverController: ServerController;
  _logger: Logger;
  _serverIdx = -1;

  constructor(serverIdx: number|null, gateway: Gateway, serverController: ServerController, logger: Logger) {
    if(isNumber(serverIdx)) { // Is an HTTP server instance
      const servers = serverController.getServers();
      this._port = servers[serverIdx].controlPort;
      this._serverIdx = serverIdx;
    } else { // Is a TCP server instance
      this._port = gateway.controlPort;
    }
    this._serverController = serverController;
    this._logger = logger;
    bindAll(this, [
      'start',
      'handleVersion',
      'handleDrainGeneralRelayCounts',
      'handleDrainHostRelayCounts',
      'handleReload',
      'handleRebuild',
      'handleRestart',
      'handleShutdown',
    ]);
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      express()
        .get(ControlServer.routes.VERSION, this.handleVersion)
        .post(ControlServer.routes.DRAIN_GENERAL_RELAY_COUNTS, this.handleDrainGeneralRelayCounts)
        .post(ControlServer.routes.DRAIN_HOST_RELAY_COUNTS, this.handleDrainHostRelayCounts)
        .post(ControlServer.routes.RELOAD, this.handleReload)
        .post(ControlServer.routes.REBUILD, this.handleRebuild)
        .post(ControlServer.routes.RESTART, this.handleRestart)
        .post(ControlServer.routes.SHUTDOWN, this.handleShutdown)
        .listen(this._port, () => {
          this._logger.gatewayInfo(`Control server listening at port ${this._port}`);
          resolve();
        });
    });
  }

  async handleVersion(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { version } = await fs.readJson(path.resolve(__dirname, '../../package.json'));
      res.send(version);
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
      res.sendStatus(500);
    }
  }

  async handleDrainGeneralRelayCounts(req: express.Request, res: express.Response): Promise<void> {
    try {
      const serverIdx = this._serverIdx;
      const servers = this._serverController.getServers();
      if(serverIdx > -1) { // It is an HTTP server instance
        // this._logger.gatewayInfo(`HTTP drain general relay counts server ${serverIdx}`);
        const generalRelayCounts = this._serverController.drainGeneralRelayCounts();
        res.type('application/json');
        res.send(JSON.stringify(generalRelayCounts));
      } else { // It is a TCP server instance
        // this._logger.gatewayInfo('TCP drain general relay counts');
        const generalRelayCountsArr: GeneralRelayCounts[] = []
        for(const server of servers) {
          try {
            const { body } = await request
              .post(`http://localhost:${server.controlPort}${ControlServer.routes.DRAIN_GENERAL_RELAY_COUNTS}`)
              .accept('application/json')
              .timeout(10000);
            generalRelayCountsArr.push(body);
          } catch(err: any) {
            this._logger.gatewayError(`Drain general relay counts error: ` + err.message + '\n' + err.stack);
          }
        }
        const combinedGeneralRelayCounts: GeneralRelayCounts = {
          start: 0,
          end: 0,
          relays: {},
        };
        for(const generalRelayCounts of generalRelayCountsArr) {
          if(!generalRelayCounts.start)
            continue;
          if(generalRelayCounts.start < combinedGeneralRelayCounts.start || combinedGeneralRelayCounts.start === 0)
            combinedGeneralRelayCounts.start = generalRelayCounts.start;
          if(generalRelayCounts.end > combinedGeneralRelayCounts.end)
            combinedGeneralRelayCounts.end = generalRelayCounts.end;
          for(const [chainId, count] of Object.entries(generalRelayCounts.relays)) {
            if(!combinedGeneralRelayCounts.relays[chainId])
              combinedGeneralRelayCounts.relays[chainId] = 0;
            combinedGeneralRelayCounts.relays[chainId] += count;
          }
        }
        res.type('application/json');
        res.send(JSON.stringify(combinedGeneralRelayCounts));
      }
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
      res.sendStatus(500);
    }
  }

  async handleDrainHostRelayCounts(req: express.Request, res: express.Response): Promise<void> {
    try {
      const serverIdx = this._serverIdx;
      const servers = this._serverController.getServers();
      if(serverIdx > -1) { // It is an HTTP server instance
        const hostRelayCounts = this._serverController.drainHostRelayCounts();
        res.type('application/json');
        res.send(JSON.stringify(hostRelayCounts));
      } else { // It is a TCP server instance
        const hostRelayCounts: {[host: string]: number[]} = {};
        for(const server of servers) {
          try {
            const { body } = await request
              .post(`http://localhost:${server.controlPort}${ControlServer.routes.DRAIN_HOST_RELAY_COUNTS}`)
              .accept('application/json')
              .timeout(10000);
            for(const [host, times] of Object.entries(body as {[host: string]: number[]})) {
              hostRelayCounts[host] = (hostRelayCounts[host] || []).concat(times);
            }
          } catch(err: any) {
            this._logger.gatewayError(`Drain host relay counts error: ` + err.message + '\n' + err.stack);
          }
        }
        res.type('application/json');
        res.send(JSON.stringify(hostRelayCounts));
      }
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
      res.sendStatus(500);
    }
  }

  async handleReload(req: express.Request, res: express.Response): Promise<void> {
    try {
      const serverIdx = this._serverIdx;
      const servers = this._serverController.getServers();
      if(serverIdx > -1) { // It is an HTTP server instance
        this._logger.gatewayInfo(`HTTP reload haproxy server ${serverIdx}`);
        await this._serverController.reloadHaproxy();
      } else { // It is a TCP server instance
        this._logger.gatewayInfo('TCP reload haproxy');
        await this._serverController.reloadHaproxy();
        for(const server of servers) {
          await request
            .post(`http://localhost:${server.controlPort}${ControlServer.routes.RELOAD}`)
            .timeout(60000);
        }
      }
      res.sendStatus(200);
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
      res.sendStatus(500);
    }
  }

  async handleRebuild(req: express.Request, res: express.Response): Promise<void> {
    try {
      const serverIdx = this._serverIdx;
      const servers = this._serverController.getServers();
      if(serverIdx > -1) { // It is an HTTP server instance
        this._logger.gatewayInfo(`HTTP rebuild server ${serverIdx} routing tables`);
        await this._serverController.rebuild();
      } else { // It is a TCP server instance
        this._logger.gatewayInfo('TCP rebuild all routing tables');
        for(const server of servers) {
          await request
            .post(`http://localhost:${server.controlPort}${ControlServer.routes.REBUILD}`)
            .timeout(60000);
        }
      }
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
      res.sendStatus(500);
    }
  }

  async handleRestart(req: express.Request, res: express.Response): Promise<void> {
    try {
      const serverIdx = this._serverIdx;
      const servers = this._serverController.getServers();
      if(serverIdx > -1) { // It is an HTTP server instance
        // console.log(`Restart server ${serverIdx}`);
      } else { // It is a TCP server instance
        this._logger.gatewayInfo('TCP restart all servers');
        await this._serverController.restartAllServers();
      }
      res.sendStatus(200);
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
      res.sendStatus(500);
    }
  }

  async handleShutdown(req: express.Request, res: express.Response): Promise<void> {
    try {
      const serverIdx = this._serverIdx;
      const servers = this._serverController.getServers();
      if(serverIdx > -1) { // It is an HTTP server instance
        // console.log(`Shutdown server ${serverIdx}`);
      } else { // It is a TCP server instance
        this._logger.gatewayInfo('TCP restart all servers');
        await this._serverController.shutdownAllServers();
      }
      res.sendStatus(200);
      await timeout(1000);
      process.kill(0);
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
      res.sendStatus(500);
    }
  }

}
