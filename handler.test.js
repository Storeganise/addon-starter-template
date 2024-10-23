import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import test, { deepStrictEqual as same } from 'assert';
import handler from './handler.js';


describe('Your integration', function () {
  let storeganise, yourIntegration;
  describe('handler', function () {
    afterEach(sinon.restore);
    beforeEach(function () {
      storeganise = {
        get: sinon.stub().resolves([]),
        put: sinon.stub().resolves(),
        post: sinon.stub().resolves(),
      };
      yourIntegration = sinon.stub();
    });

    it('syncs move-in', async function () {
      const rental = {
        id: 'ur_1',
        customFields: {},
        unit: {
          name: 'a1',
          customFields: {},
        },
        owner: {
          id: 'u_1',
          email: 'x@y.co',
          customFields: {},
        }
      };
      storeganise.get
        .withArgs('unit-rentals/ur_1').resolves(rental);
      yourIntegration
        .withArgs('rent').resolves({ pinCode: 'PIN123' });

      await handler({ event: 'job.unit_moveIn.completed', data: { unitRentalId: 'ur_1' }, storeganise, yourIntegration });

      same(storeganise.put.args, [['unit-rentals/ur_1', { customFields: { yourIntegration_pin: 'PIN123' } }]]);
    });
  });
});
