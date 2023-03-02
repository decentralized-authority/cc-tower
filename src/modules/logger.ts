import winston, { Logger as WinstonLogger } from 'winston';
import path from 'path';
import Transport from 'winston-transport';
import { ApiClient } from './api-client';

class ApiLogger extends Transport {

  _logFunc: (logs: string[])=>Promise<boolean>;
  _handleError: (err: Error)=>void;

  constructor(logFunc: (logs: string[])=>Promise<boolean>, handleError: (err: Error)=>void = console.error) {
    super();
    this._logFunc = logFunc;
    this._handleError = handleError;
  }

  log(info: any, callback: ()=>void) {
    this._logFunc([`${info.message} {${info.timestamp}}`])
      .catch(err => this._handleError(err));
    callback();
  }

}

export class Logger {

  readonly _logDir: string;
  readonly _apiClient: ApiClient;
  private _winstonGatewayInfo: WinstonLogger|undefined;
  private _winstonGatewayError: WinstonLogger|undefined;
  private _winstonServerInfo: WinstonLogger|undefined;
  private _winstonServerNotice: WinstonLogger|undefined;

  constructor(logDir: string, apiClient: ApiClient) {
    this._logDir = logDir;
    this._apiClient = apiClient;
  }

  async initialize(): Promise<void> {
    this._winstonGatewayInfo = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple(),
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(this._logDir, 'gateway-info.log'),
          maxsize: 4 * 1024000,
          maxFiles: 10,
          tailable: true,
        }),
        new winston.transports.Console(),
        new ApiLogger(this._apiClient.postGatewayInfoLog.bind(this._apiClient)),
      ],
    });
    this._winstonGatewayError = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple(),
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(this._logDir, 'gateway-error.log'),
          maxsize: 4 * 1024000,
          maxFiles: 10,
          tailable: true,
        }),
        new winston.transports.Console(),
        new ApiLogger(this._apiClient.postGatewayErrorLog.bind(this._apiClient)),
      ],
    });
    this._winstonServerInfo = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple(),
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(this._logDir, 'server-info.log'),
          maxsize: 4 * 1024000,
          maxFiles: 10,
          tailable: true,
        }),
        // new winston.transports.Console(),
      ],
    });
    this._winstonServerNotice = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple(),
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(this._logDir, 'server-notice.log'),
          maxsize: 4 * 1024000,
          maxFiles: 10,
          tailable: true,
        }),
        new winston.transports.Console(),
        new ApiLogger(this._apiClient.postGatewayServerNoticeLog.bind(this._apiClient)),
      ],
    });

  }

  serverInfo(info: string) {
    this._winstonServerInfo?.info(info);
  }

  serverNotice(info: string) {
    this._winstonServerNotice?.info(info);
  }

  gatewayInfo(info: string) {
    this._winstonGatewayInfo?.info(info);
  }

  gatewayError(error: string) {
    this._winstonGatewayError?.error(error);
  }

}
