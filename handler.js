async function rent({ storeganise, yourIntegration, rental, unit = rental.unit, owner = rental.owner }) {
  const result = await yourIntegration('rent', {
    method: 'POST',
    body: {
      unitId: unit.name,
      email: owner.email,
      first_name: owner.firstName,
      last_name: owner.lastName,
      suspended: Boolean(rental.overdue),
    }
  });
  await storeganise.put(`unit-rentals/${rental.id}`, { customFields: { yourIntegration_pin: result.pinCode } });
}

async function vacate({ storeganise, yourIntegration, rental, unit = rental.unit }) {
  const result = await yourIntegration('vacate', {
    method: 'POST',
    body: {
      unitId: unit.name,
    }
  });
  await storeganise.put(`unit-rentals/${rental.id}`, { customFields: { yourIntegration_pin: null } });
}


export default async function ({ storeganise, yourIntegration, event, data = {}, addon }) {
  switch (event) {
    // Access control integrations typically use these events:
    case 'job.unit_moveIn.completed': {
      const rental = await storeganise.get(`unit-rentals/${data.unitRentalId}`, { include: 'unit,owner,customFields' });
      await rent({ storeganise, yourIntegration, rental });
      break;
    }

    case 'job.unit_moveOut.completed': {
      const rental = await storeganise.get(`unit-rentals/${data.unitRentalId}`, { include: 'unit,customFields' });
      await vacate({ storeganise, yourIntegration, rental });
      break;
    }

    case 'job.unit_transfer.completed': {
      const oldRental = await storeganise.get(`unit-rentals/${data.oldRentalId}`, { include: 'unit,customFields' });
      const newRental = await storeganise.get(`unit-rentals/${data.newRentalId}`, { include: 'unit,owner,customFields' });
      await vacate({ storeganise, yourIntegration, rental: oldRental })
        .catch(err => console.error(err));
      await rent({ storeganise, yourIntegration, rental: newRental });
      break;
    }
    
    case 'unitRental.updated': {
      const rental = await storeganise.get(`unit-rentals/${data.unitRentalId}`, { include: 'unit,owner,customFields' });
      if (rental.state !== 'occupied') return;
      try {
        console.log('unitRental customFields (usually) were updated', data.changedKeys);
        await rent({ storeganise, yourIntegration, rental });
      } catch (err) {
        await storeganise.post('jobs', {
          type: 'task',
          ownerId: null,
          data: {
            targetType:'unit',
            targetId: rental.unit.id,
            title: 'Errors in your integration sync',
            desc: err.message,
          },
        })
          .catch(err => console.error('SG_IMPORTANT', err));
      }
      break;
    }

    case 'unitRental.markOverdue':
    case 'unitRental.unmarkOverdue': {
      const rental = await storeganise.get(`unit-rentals/${data.unitRentalId}`, { include: 'unit,owner,customFields' });
      if (rental.state !== 'occupied') return;
      try {
        console.log('unitRental overdue was updated', data.changedKeys);
        // note: in some case you may want to use owner.overdue instead or additionally to unitRental.overdue
        // owner.overdue is set when at least one active rental is overdue
        // owner.overdue is unset if all active rentals are ok in payments
        await rent({ storeganise, yourIntegration, rental });
      } catch (err) {
        await storeganise.post('jobs', {
          type: 'task',
          ownerId: null,
          data: {
            targetType:'unit',
            targetId: rental.unitId,
            title: 'Errors in your integration sync',
            desc: err.message,
          },
        })
          .catch(err => console.error('SG_IMPORTANT', err));
      }
      break;
    }


    // Accounting software integrations typically use these events:
    case 'invoice.state.updated':
    case 'invoice.payments.updated': {
      const invoice = await storeganise.get(`invoices/${data.invoiceId}`, { include: 'owner,customFields' });
      if (!['sent', 'failed', 'paid'].includes(invoice.state)) break; // only handle send, paid, failed invoices

      // ...
      break;
    }
    case 'user.updated': {
      const owner = await storeganise.get(`users/${data.userId}`, { include: 'customFields' });
      try {
        // Resync user details ...
      } catch (err) {
        await storeganise.post('jobs', {
          type: 'task',
          ownerId: null,
          data: {
            targetType:'user',
            targetId: owner.id,
            title: 'Errors in your integration sync',
            desc: err.message,
          },
        })
          .catch(err => console.error('SG_IMPORTANT', err));
      }
      break;
    }


    // Custom billing events:
    case 'billing.list': {
      const user = await storeganise.get(`users/${data.userId}`, { include: 'customFields' });
      if (!user.customFields.yourIntegration_token) return []; // for example store your remote payment customerId as yourIntegration_token user custom field
      const data = await yourIntegration(`tokens?${new URLSearchParams({ token: user.customFields.yourIntegration_token })}`);
      return data;
      // the format of the response should be an array of object with either a `card` or `bank` property
      // example:
      /*
        [{
          "card": {
            "number": "411111...111",
            "expiry": {
              "month": "99",
              "year": "00"
            },
            "name": "Cyril Testing",
            "scheme": "Visa",
            "localisation": "International",
            "type": "Debit"
          }
        }]
      */
    }
    
    case 'billing.charge': {
      const user = await storeganise.get(`users/${data.userId}`, { include: 'customFields' });
      // data.amount can be negative for refunds, usually you'll need to handle these separately: if (data.amount < 0) { .. }
      if (!user.customFields.bpoint_token) {
        return;
      }

      // Process charge using payApi
      const txn = await yourIntegration('payments', {
        method: 'POST',
        body: {
          token: user.customFields.bpoint_token,
          amount: Math.round(data.amount * 100), // in cents (often needed), as data.amount is in main currency unit, not cents
          currency: addon.customFields.pay_currency, // example use of addon custom fields
        }
      });
      // Send response in this format:
      return { 
        id: txn.txnNumber, // required
        amount: txn.amount, // required
        status: txn.responseCode === '0' ? 'succeeded' : txn.responseCode === '1' ? 'processing' : 'failed', // required
        currency: txn.currency, // optional
        paymentMethod: txn.paymentMethod, // optional
        isTest: txn.isTestTxn, // optional
      };
    }

    case 'billing.checkout': {
      const user = await storeganise.get(`users/${data.userId}`, { include: 'customFields' });
      // Here you need to render or redirect to a custom checkout form, where customer will enter their card or bank account details
      // You should use a proper HTML templating (react, handlebars, ..)
      return `<!doctype html>
<html>
<head>
  <title>BPOINT Payment</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body>
  <h1>Pay with {{customBilling}}</h1>
  <form>
    ...
  </form>
</body>
</html>`;
      }

    default: {
      console.log(`Unhandled event ${event}; make sure to unsubscribe from events you don't handle`);
    }
  }
}