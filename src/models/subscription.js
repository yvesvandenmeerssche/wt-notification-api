const crypto = require('crypto');

const { db } = require('../config');

const SUBSCRIPTIONS_TABLE = 'subscriptions',
  SUBJECTS_TABLE = 'subjects',
  ID_LENGTH = 32;

module.exports.createTable = async function () {
  await db.schema.createTable(SUBSCRIPTIONS_TABLE, (table) => {
    table.string('id', ID_LENGTH).primary();
    table.string('wt_index', 63).notNullable();
    table.string('resource_type', 63).notNullable();
    table.string('resource_address', 63);
    table.string('action', 63);
    table.text('url').notNullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps(true, true);

    // Add an index for easier retrieval of subscriptions.
    table.index(['wt_index', 'resource_type', 'active', 'resource_address', 'action', 'url', 'id']);
  });

  await db.schema.createTable(SUBJECTS_TABLE, (table) => {
    table.increments().primary();
    table.string('name', 63);
    table.string('subscription_id', ID_LENGTH).notNullable();

    table.foreign('subscription_id').references('id').inTable(SUBSCRIPTIONS_TABLE);
    table.unique(['subscription_id', 'name']);
  });
};

module.exports.dropTable = async function () {
  await db.schema.dropTableIfExists(SUBJECTS_TABLE);
  await db.schema.dropTableIfExists(SUBSCRIPTIONS_TABLE);
};

async function _generateID () {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(ID_LENGTH / 2, (err, buffer) => {
      if (err) {
        return reject(err);
      }
      resolve(buffer.toString('hex'));
    });
  });
}

function _normalize (data) {
  data = Object.assign({}, data);
  data.active = (data.active === undefined) ? true : Boolean(data.active);
  for (let field of ['resourceAddress', 'action', 'subjects']) {
    if (([null, undefined, ''].indexOf(data[field]) !== -1) || (data[field].length === 0)) {
      delete data[field];
    }
  }
  return data;
}

/**
 * Create a new subject-subscription binding.
 *
 * @param {String} name
 * @param {String} subscriptionid
 * @return {Promise<Object>}
 */
async function addSubjects (names, subscriptionId) {
  if (names.length !== 0) {
    await db(SUBJECTS_TABLE).insert(names.map((name) => {
      return { name, 'subscription_id': subscriptionId };
    }));
  }
  return { names, subscriptionId };
};

/**
 * Create a new subscription and return its representation.
 *
 * @param {Object} subscriptionData
 * @return {Promise<Object>}
 */
module.exports.create = async function (subscriptionData) {
  subscriptionData = _normalize(subscriptionData);
  const id = await _generateID();
  await db(SUBSCRIPTIONS_TABLE).insert({
    'id': id,
    'wt_index': subscriptionData.wtIndex,
    'resource_type': subscriptionData.resourceType,
    'resource_address': subscriptionData.resourceAddress,
    'action': subscriptionData.action,
    'url': subscriptionData.url,
    'active': subscriptionData.active,
  });
  if (subscriptionData.subjects) {
    await addSubjects(subscriptionData.subjects, id);
  }
  return Object.assign({ id }, subscriptionData);
};

/**
 * Get a subscription by its ID.
 *
 * @param {String} ID
 * @return {Promise<Object>}
 */
module.exports.get = async function (id) {
  const subscription = (await db(SUBSCRIPTIONS_TABLE).where({
      'id': id,
    }).select('wt_index', 'resource_type', 'resource_address', 'action', 'url', 'active'))[0],
    subjects = (await db(SUBJECTS_TABLE).select('name').where({
      'subscription_id': id,
    })).map((x) => x.name);
  return subscription && _normalize({
    id: id,
    wtIndex: subscription.wt_index,
    resourceType: subscription.resource_type,
    resourceAddress: subscription.resource_address,
    action: subscription.action,
    url: subscription.url,
    active: subscription.active,
    subjects: subjects,
  });
};

/**
 * Deactivate a subscription.
 *
 * @param {String} subscriptionId
 * @return {Promise<Boolean>}
 */
module.exports.deactivate = async function (id) {
  return Boolean(await db(SUBSCRIPTIONS_TABLE).where('id', id).andWhere('active', true).update({
    'active': false,
    'updated_at': db.fn.now(),
  }));
};

/**
 * Get a set of URLs together with the respective
 * subscription IDs of active subscriptions corresponding
 * to the given notification attributes.
 *
 * @param {Object} notification
 *
 * Notification attributes are:
 *
 *  - wtIndex
 *  - resourceType
 *  - resourceAddress
 *  - action
 *  - [optional] subjects
 *
 * A matching subscription is such that it either:
 *
 * - has the specified value of the given property
 *
 *   or
 *
 * - does not have the property defined at all
 *
 * When subjects are defined, a subscription is matched when the
 * intersection of the sets of subjects has at least one item.
 *
 * @param {Object} notification
 * @param {Object} offset
 * @param {Number} limit
 * @return {Promise<Object>}
 */
module.exports.getURLs = async function (notification, limit, offset) {
  for (let field of ['wtIndex', 'resourceType', 'resourceAddress', 'action']) {
    if (!notification[field]) {
      throw new Error(`getURLs - Missing ${field}`);
    }
  }
  let table = db(SUBSCRIPTIONS_TABLE);
  if (notification.subjects) {
    table = table.leftOuterJoin(SUBJECTS_TABLE, `${SUBSCRIPTIONS_TABLE}.id`, '=',
      `${SUBJECTS_TABLE}.subscription_id`);
  }
  let query = table.where({
    'wt_index': notification.wtIndex,
    'resource_type': notification.resourceType,
    'active': true,
  }).andWhere(function () {
    this.where('resource_address', notification.resourceAddress)
      .orWhere('resource_address', null);
  }).andWhere(function () {
    this.where('action', notification.action)
      .orWhere('action', null);
  });

  if (offset) {
    query = query.andWhere(function () {
      this.where('url', '>', offset.url).orWhere(function () {
        this.where('url', offset.url).andWhere(`${SUBSCRIPTIONS_TABLE}.id`, '>=', offset.id);
      });
    });
  }

  if (notification.subjects) {
    query = query.andWhere(function () {
      this.whereIn('name', notification.subjects).orWhere('name', null);
    });
  }

  query = query
    .select(`${SUBSCRIPTIONS_TABLE}.id`, 'url')
    .orderBy('url')
    .orderBy(`${SUBSCRIPTIONS_TABLE}.id`);

  if (limit) {
    query = query.limit(limit + 1);
  }

  const subscriptions = await query,
    urls = {};

  let next = null;
  if (limit && subscriptions.length > limit) {
    const last = subscriptions[subscriptions.length - 1];
    next = { url: last.url, id: last.id };
    subscriptions.splice(-1, 1);
  }

  for (let subscription of subscriptions) {
    urls[subscription.url] = urls[subscription.url] || [];
    urls[subscription.url].push(subscription.id);
  }
  return {
    urls: urls,
    next: next,
  };
};
