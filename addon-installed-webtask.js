// webtask used for ensuring other models custom fields are created in the business once addon is installed
export default async function ({ api, context }) {

  await api.ensureCustomField('unitRental', {
    type: 'string',
    code: 'yourIntegration_pin',
    title: { en: 'Your integration PIN code' },
    ownerAcl: 'read',
  });
}