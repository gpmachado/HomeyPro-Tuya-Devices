'use strict';

module.exports = {
  async onPairListDevices({ homey }) {
    return [
      {
        name: 'Zemismart Wall Switch 1 Gang',
        settings: {},
      },
    ];
  },
};
