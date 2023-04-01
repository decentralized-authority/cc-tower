import { Logger } from './modules/logger';
import fs from 'fs-extra';
import path from 'path';
import { Docker } from './modules/docker';
import { configPath, logDir, logDir as baseLogDir, rootDir } from './constants';
import commandLineArgs from 'command-line-args';
import { ServerController } from './modules/server-controller';
import { ControlServer } from './modules/control-server';
import { ApiClient } from './modules/api-client';
import { LocalConfig } from './modules/local-config';
import prompts from 'prompts';
import colors from 'colors/safe';
import { DOCKER_NETWORK } from './constants';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const { version } = fs.readJsonSync(path.resolve(__dirname, '../package.json'));

const ensureDirs = async function(): Promise<void> {
  fs.ensureDirSync(rootDir);
  if(!fs.pathExistsSync(rootDir))
    fs.ensureDirSync(rootDir);
  if(!fs.pathExistsSync(baseLogDir))
    fs.ensureDirSync(baseLogDir);
}

const configFileExists = (): boolean => {
  return fs.pathExistsSync(configPath);
};

const init = async function(apiEndpoint: string, providerId: string, gatewayId: string, keyFilePath: string, key: string): Promise<boolean> {
  try {
    let config: LocalConfig;
    if(!configFileExists()) {
      const apiClient = new ApiClient(
        apiEndpoint,
        providerId,
        gatewayId,
        key,
      );
      console.log('-> Checking provider credentials');
      const token = await apiClient.checkToken();
      if(!token) {
        console.error(colors.red('Unable to authenticate provider account. Check account endpoint and credentials.'));
        return false;
      }
      config = new LocalConfig({
        apiEndpoint,
        providerId,
        gatewayId,
        keyFilePath,
        hapCpus: LocalConfig.defaultHapCpus,
        hapMem: LocalConfig.defaultHapMem,
      });
      await fs.writeJson(configPath, config.toObject(), {spaces: 2});
      await fs.writeFile(keyFilePath, key, 'utf8');
      console.log(colors.green('Gateway successfully initialized!'));
    } else {
      console.log('Gateway already initialized.');
    }
    return true;
  } catch(err) {
    console.error(err);
    return false;
  }
};

const mainDefinitions = [
  {name: 'command', defaultOption: true},
];
const mainOptions = commandLineArgs(mainDefinitions, {stopAtFirstUnknown: true});

const help = `
Community Chains Gateway v${version}

Available Commands:
     init - Initializes the Community Chains Gateway
    start - Starts all Community Chains Gateway servers
     stop - Stops all Community Chains Gateway servers
  restart - Restarts all Community Chains Gateway servers
  version - Show version

Global Flags:
  -h, --help - Show help
`;

const initHelp = `
Community Chains Gateway v${version}

init

Required Flags:
  --provider     - The provider ID
  --gateway      - The gateway ID
  --api-endpoint - The URL of the Community Chains API

Optional Flags:
   --key-file    - The path to the key file (default: ~/.cc-gateway/key)

Global Flags:
  -h, --help     - Show help
`;

const startHelp = `
Community Chains Gateway v${version}

start

Global Flags:
  -h, --help     - Show help
`;

const prestart = async function() {

  let argv = mainOptions._unknown || [];
  switch(mainOptions.command) {
    case 'init': {
      const initDefinitions = [
        {name: 'api-endpoint', type: String},
        {name: 'provider', type: String},
        {name: 'gateway', type: String},
        {name: 'key-file', type: String},
        {name: 'help', alias: 'h', type: Boolean},
      ];
      const initOptions = commandLineArgs(initDefinitions, {argv, stopAtFirstUnknown: true});
      const logInitHelp = () => {
        console.log(initHelp.trim());
      };
      if(initOptions.help) {
        logInitHelp();
        return;
      }
      const apiEndpoint = initOptions['api-endpoint'] ? initOptions['api-endpoint'].trim() : '';
      const provider = initOptions.provider ? initOptions.provider.trim() : '';
      const gateway = initOptions.gateway ? initOptions.gateway.trim() : '';
      const keyFilePath = initOptions['key-file'] ? initOptions['key-file'].trim() : path.join(rootDir, 'key');
      if(!apiEndpoint || !provider || !gateway) {
        logInitHelp();
        return;
      }
      let key = '';
      if(fs.pathExistsSync(keyFilePath)) {
        key = fs.readFileSync(keyFilePath, 'utf8').trim();
      }
      if(!key) {
        const res = await prompts({
          type: 'password',
          name: 'key',
          message: 'Enter your provider key',
          validate: value => !value.trim() ? 'You must enter a valid provider key' : true,
        });
        key = res.key.trim();
      }
      await ensureDirs();
      const success = await init(apiEndpoint, provider, gateway, keyFilePath, key);
      if(!success)
        process.exit(1);
      break;
    }
    case 'start': {
      const startDefinitions = [
        {name: 'help', alias: 'h', type: Boolean},
      ];
      const startOptions = commandLineArgs(startDefinitions, {argv, stopAtFirstUnknown: true});
      if(startOptions.help) {
        console.log(startHelp.trim());
        return;
      }
      await ensureDirs();
      if(!configFileExists()) {
        console.log('You must initialize the gateway first');
        return;
      }
      const configData = await fs.readJson(configPath);
      if(!configData.hapCpus)
        configData.hapCpus = LocalConfig.defaultHapCpus;
      if(!configData.hapMem)
        configData.hapMem = LocalConfig.defaultHapMem;
      const config = new LocalConfig(configData);
      const apiClient = new ApiClient(
        config.apiEndpoint,
        config.providerId,
        config.gatewayId,
        config.getKey(),
      );
      console.log('Authenticating provider account');
      const token = await apiClient.checkToken();
      if(!token) {
        console.error(colors.red('Unable to authenticate provider account. Check account endpoint and credentials.'));
        process.exit(1);
      }

      const logger = new Logger(logDir, apiClient);
      await logger.initialize();

      logger.gatewayInfo(`Starting Community Chains Gateway v${version}`);
      logger.gatewayInfo('Pulling provider & gateway info');
      const [ provider, gateway ] = await Promise.all([
        apiClient.getProvider(),
        apiClient.getGateway(),
      ]);

      const docker = new Docker();
      await docker.createNetwork(DOCKER_NETWORK);
      docker.on(Docker.events.INFO, (message: string) => {
        logger.gatewayInfo(message);
      });
      docker.on(Docker.events.ERROR, (err: Error) => {
        logger.gatewayError(err + '\n' + err.stack);
      });

      const serverController = new ServerController(config, gateway, apiClient, docker, logger);
      await serverController.initialize();
      await serverController.startAll();
      await serverController.startTcpServer();

      try {
        const controlServer = new ControlServer(null, gateway, serverController, logger);
        await controlServer.start();
      } catch(err: any) {
        logger.gatewayError(err.message + '\n' + err.stack);
        throw err;
      }
      break;
    }
    case 'help': {
      console.log(help.trim());
      break;
    }
    case 'version': {
      console.log(version);
      break;
    }
    case 'server': {
      const commandDefinitions = [
        {name: 'command', defaultOption: true},
      ];
      const commandOptions = commandLineArgs(commandDefinitions, {argv, stopAtFirstUnknown: true});
      argv = commandOptions._unknown || [];
      switch(commandOptions.command) {
        case 'start': {
          const startDefinitions = [
            {name: 'idx', defaultOption: true}
          ];
          const startOptions = commandLineArgs(startDefinitions, {argv, stopAtFirstUnknown: true});
          argv = startOptions._unknown || [];
          const idx = startOptions.idx;

          const configData = await fs.readJson(configPath);
          if(!configData.hapCpus)
            configData.hapCpus = LocalConfig.defaultHapCpus;
          if(!configData.hapMem)
            configData.hapMem = LocalConfig.defaultHapMem;
          const config = new LocalConfig(configData);
          const apiClient = new ApiClient(
            config.apiEndpoint,
            config.providerId,
            config.gatewayId,
            config.getKey(),
          );
          const gateway = await apiClient.getGateway();

          const logDir = path.join(baseLogDir, `http-server-${idx}`);
          await fs.ensureDirSync(logDir);
          const logger = new Logger(logDir, apiClient);
          await logger.initialize();

          const docker = new Docker();
          await docker.createNetwork(DOCKER_NETWORK);
          docker.on(Docker.events.INFO, (message: string) => {
            logger.gatewayInfo(message);
          });
          docker.on(Docker.events.ERROR, (err: Error) => {
            logger.gatewayError(err + '\n' + err.stack);
          });

          let serverController: ServerController;

          try {
            serverController = new ServerController(config, gateway, apiClient, docker, logger);
            await serverController.initialize();
            await serverController.startHttpServer(idx);
            const controlServer = new ControlServer(parseInt(idx), gateway, serverController, logger);
            await controlServer.start();
          } catch(err: any) {
            logger.gatewayError(err.message + '\n' + err.stack);
            setTimeout(() => {
              process.exit(1);
            }, 1000);
          }

          break;
        }
        default: {
          console.log(`Unknown command: ${commandOptions.command}\n${help}`);
        }
      }
      break;
    }
    default: {
      console.log(`Unknown command: ${mainOptions.command}\n${help.trim()}`);
    }
  }
};

prestart().catch(err => {
  console.error(err)
  process.exit(1);
});
