const { db } = require('../config');

const SUBSCRIPTIONS_TABLE = 'subscriptions';
const SUBJECTS_TABLE = 'subjects';

module.exports.createTable = async function () {
  await db.schema.createTable(SUBSCRIPTIONS_TABLE, (table) => {
    table.increments().primary();
    table.string('wt_index', 63).notNullable();
    table.string('hotel_address', 63);
    table.string('action', 63);
    table.text('url').notNullable();
    table.timestamps();
  });

  await db.schema.createTable(SUBJECTS_TABLE, (table) => {
    table.increments().primary();
    table.string('name', 63);
    table.integer('subscription_id').unsigned().notNullable();

    table.foreign('subscription_id').references('id').inTable(SUBSCRIPTIONS_TABLE);
    table.unique(['name', 'subscription_id']);
  });
};

module.exports.dropTable = async function () {
  await db.schema.dropTableIfExists(SUBJECTS_TABLE);
  await db.schema.dropTableIfExists(SUBSCRIPTIONS_TABLE);
};

/**
 * Create a new subject-subscription binding.
 *
 * @param {String} name
 * @param {String} subscriptionid
 * @return {Promise<Object>}
 */
async function addSubject (name, subscriptionId) {
  await db(SUBJECTS_TABLE).insert({
    'name': name,
    'subscription_id': subscriptionId,
  });
  return { name, subscriptionId };
};

/**
 * Create a new subscription and return its representation.
 *
 * @param {Object} subscriptionData
 * @return {Promise<Object>}
 */
module.exports.create = async function (subscriptionData) {
  const subscriptionId = (await db(SUBSCRIPTIONS_TABLE).insert({
    'wt_index': subscriptionData.wtIndex,
    'hotel_address': subscriptionData.hotelAddress || null,
    'action': subscriptionData.action || null,
    'url': subscriptionData.url,
  }))[0];
  for (let subject of (subscriptionData.subjects || [])) {
    await addSubject(subject, subscriptionId);
  }
  return {
    id: subscriptionId,
    wtIndex: subscriptionData.wtIndex,
    hotelAddress: subscriptionData.hotelAddress,
    action: subscriptionData.action,
    subjects: subscriptionData.subjects,
    url: subscriptionData.url
  };
};

/**
 * Get a subscription by its ID.
 *
 * @param {Number} ID
 * @return {Promise<Object>}
 */
module.exports.get = async function (id) {
  const subscription = (await db(SUBSCRIPTIONS_TABLE).select('id', 'wt_index', 'hotel_address', 'action', 'url').where({
      'id': id,
    }))[0],
    subjects = (await db(SUBJECTS_TABLE).select('name').where({
      'subscription_id': id,
    })).map((x) => x.name);
  return subscription && {
    id: subscription.id,
    wtIndex: subscription.wt_index,
    hotelAddress: subscription.hotel_address,
    action: subscription.action,
    url: subscription.url,
    subjects: subjects,
  };
};
