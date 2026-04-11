const { series, rimraf } = require('nps-utils');

module.exports = {
  scripts: {
    default: 'nps start',
    start: {
      script: 'cross-env node dist/app.js',
      description: 'Starts the built app from the dist directory',
    },
    startApi: {
      script: 'cross-env node dist/app.js',
      description: 'Starts API runtime from the built app',
    },
    serve: {
      script: series(
        'nps banner.serve',
        'cross-env nodemon --watch src --watch app.ts --ext ts,js,json --exec "node --import tsx app.ts"'
      ),
      description: 'Serves the app locally and watches for changes',
    },
    serveApi: {
      script: series(
        'nps banner.serve',
        'cross-env nodemon --watch src --watch app.ts --ext ts,js,json --exec "node --import tsx app.ts"'
      ),
      description: 'Serves API runtime locally and watches for changes',
    },
    copyLocalhostDotEnv: {
      script: series('nps clean.dotEnv', 'nps copy.localhostDotEnv'),
      description: 'Copies localhost environment file to project root',
    },
    build: {
      script: series('nps banner.build', 'nps clean.dist', 'nps transpile'),
      description: 'Builds the app into the dist directory',
    },
    banner: {
      build: {
        hiddenFromHelp: true,
        silent: true,
        script: 'node -e "console.log(\'Building local app...\')"',
      },
      serve: {
        hiddenFromHelp: true,
        silent: true,
        script: 'node -e "console.log(\'Starting local server...\')"',
      },
    },
    clean: {
      dotEnv: {
        script: rimraf('./.env'),
        hiddenFromHelp: true,
      },
      dist: {
        script: rimraf('./dist'),
        hiddenFromHelp: true,
      },
    },
    copy: {
      localhostDotEnv: {
        script: 'cp ./environments/localhost/.env ./.env',
        hiddenFromHelp: true,
      },
    },
    transpile: {
      script: 'tsc --project ./tsconfig.json',
      hiddenFromHelp: true,
    },
  },
};
