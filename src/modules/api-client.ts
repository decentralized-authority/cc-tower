import { Gateway, GatewayHosts, Provider, RpcEndpoint, SessionToken } from '../interfaces';
import request from 'superagent';
import isString from 'lodash/isString';
import dayjs from 'dayjs';

export class ApiClient {

  _endpoint: string;
  _timeout = 30000;

  _providerId: string;
  _gatewayId: string;
  _key: string;
  _sessionToken: SessionToken|null = null;

  constructor(endpoint: string, providerId: string, gatewayId: string, key: string) {
    this._endpoint = endpoint;
    this._providerId = providerId;
    this._gatewayId = gatewayId;
    this._key = key;
  }

  handleError(err: Error|string) {
    if(isString(err)) {
      console.log(err);
    } else {
      console.log(err);
    }
  }

  async _makeRequest(requestFunc: ()=>Promise<request.Response>): Promise<request.Response> {
    try {
      return await requestFunc();
    } catch(err: any) {
      const body = err?.response?.body;
      if(body && isString(body)) {
        throw new Error(body);
      } else {
        throw err;
      }
    }
  }

  async checkToken(): Promise<string> {
    try {
      let sessionToken: SessionToken;
      if(this._sessionToken && dayjs(this._sessionToken.expiration).isBefore(dayjs())) {
        sessionToken = this._sessionToken;
      } else {
        sessionToken = await this.unlock();
      }
      return sessionToken.token;
    } catch(err: any) {
      this.handleError(err);
      return '';
    }
  }

  async unlock(): Promise<SessionToken> {
    const { body } = await this._makeRequest(() => request
      .post(`${this._endpoint}/v1/providers/${this._providerId}/unlock`)
      .type('application/json')
      .timeout(this._timeout)
      .send({
        key: this._key,
      }));
    return body;
  }

  async getProvider(): Promise<Provider> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .get(`${this._endpoint}/v1/providers/${this._providerId}`)
      .set({'x-api-key': token})
      .type('application/json')
      .timeout(this._timeout));
    return body;
  }

  async getGateway(): Promise<Gateway> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .get(`${this._endpoint}/v1/providers/${this._providerId}/gateways/${this._gatewayId}`)
      .set({'x-api-key': token})
      .type('application/json')
      .timeout(this._timeout));
    return body;
  }

  async getHosts(): Promise<GatewayHosts[]> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .get(`${this._endpoint}/v1/providers/${this._providerId}/gateways/${this._gatewayId}/hosts`)
      .set({'x-api-key': token})
      .type('application/json')
      .timeout(this._timeout));
    return body;
  }

  async getRpcEndpoints(): Promise<RpcEndpoint[]> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .get(`${this._endpoint}/v1/providers/${this._providerId}/gateways/${this._gatewayId}/rpc-endpoints`)
      .set({'x-api-key': token})
      .type('application/json')
      .timeout(this._timeout));
    return body;
  }

  async postGatewayErrorLog(logs: string[]): Promise<boolean> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .post(`${this._endpoint}/v1/providers/${this._providerId}/gateways/${this._gatewayId}/error-log`)
      .set({'x-api-key': token})
      .type('application/json')
      .timeout(this._timeout)
      .send({
        logs,
      }));
    return body;
  }

  async postGatewayInfoLog(logs: string[]): Promise<boolean> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .post(`${this._endpoint}/v1/providers/${this._providerId}/gateways/${this._gatewayId}/info-log`)
      .set({'x-api-key': token})
      .type('application/json')
      .timeout(this._timeout)
      .send({
        logs,
      }));
    return body;
  }

  async postGatewayServerNoticeLog(logs: string[]): Promise<boolean> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .post(`${this._endpoint}/v1/providers/${this._providerId}/gateways/${this._gatewayId}/server-notice-log`)
      .set({'x-api-key': token})
      .type('application/json')
      .timeout(this._timeout)
      .send({
        logs,
      }));
    return body;
  }

  async postGatewayGeneralRelayLog(time: number, start: number, end: number, relays: {[chainId: string]: number}): Promise<boolean> {
    const token = await this.checkToken();
    const { body } = await this._makeRequest(() => request
      .post(`${this._endpoint}/v1/providers/${this._providerId}/gateways/${this._gatewayId}/general-relay-log`)
      .set({'x-api-key': token})
      .type('application/json')
      .send({
        time,
        start,
        end,
        relays,
      })
      .timeout(this._timeout));
    return body;
  }

}
