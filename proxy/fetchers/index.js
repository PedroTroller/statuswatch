'use strict';

const { safeJson }                                        = require('./_helpers.js');
const { fetchAlgoliaStatus }                              = require('./algolia.js');
const { fetchAuth0Status }                                = require('./auth0.js');
const { fetchAwsHealthStatus }                            = require('./awshealth.js');
const { fetchCachetStatus }                               = require('./cachet.js');
const { fetchGoogleIncidentDashboard }                    = require('./google.js');
const { fetchHerokuStatus }                               = require('./heroku.js');
const { fetchHundStatus }                                 = require('./hund.js');
const { fetchStatuspageStatus, fetchIncidentioStatus }    = require('./statuspage.js');
const { fetchInstatusStatus }                             = require('./instatus.js');
const { fetchPagerdutySatus }                             = require('./pagerduty.js');
const { fetchPosthogStatus }                              = require('./posthog.js');
const { fetchSignalStatus }                               = require('./signal.js');
const { fetchSite24x7Status }                             = require('./site24x7.js');
const { fetchSlackStatus }                                = require('./slack.js');
const { fetchSorryappStatus }                             = require('./sorryapp.js');
const { fetchStatuscastStatus }                           = require('./statuscast.js');
const { fetchStatusioStatus }                             = require('./statusio.js');
const { fetchStripeStatus }                               = require('./stripe.js');
const { fetchUptimeRobotStatus }                          = require('./uptimerobot.js');
const { fetchZendeskStatus }                              = require('./zendesk.js');

// Maps a component status string to our four-level indicator scale.
// Returns null for unknown statuses so callers can fall back gracefully.
function componentStatusToIndicator(status) {
  switch (status) {
    case 'operational':          return 'none';
    case 'degraded_performance': return 'minor';
    case 'partial_outage':       return 'major';
    case 'major_outage':         return 'critical';
    case 'under_maintenance':    return 'maintenance';
    default:                     return null;
  }
}

// Dispatches to the right fetcher based on service.type (required).
function fetchServiceStatus(service) {
  if (service.type === 'algolia')      return fetchAlgoliaStatus(service);
  if (service.type === 'auth0')        return fetchAuth0Status(service);
  if (service.type === 'awshealth')    return fetchAwsHealthStatus(service);
  if (service.type === 'cachet')       return fetchCachetStatus(service);
  if (service.type === 'google')       return fetchGoogleIncidentDashboard(service);
  if (service.type === 'heroku')       return fetchHerokuStatus(service);
  if (service.type === 'hund')         return fetchHundStatus(service);
  if (service.type === 'incidentio')   return fetchIncidentioStatus(service);
  if (service.type === 'instatus')     return fetchInstatusStatus(service);
  if (service.type === 'pagerduty')    return fetchPagerdutySatus(service);
  if (service.type === 'posthog')      return fetchPosthogStatus(service);
  if (service.type === 'signal')       return fetchSignalStatus(service);
  if (service.type === 'site24x7')     return fetchSite24x7Status(service);
  if (service.type === 'slack')        return fetchSlackStatus(service);
  if (service.type === 'sorryapp')     return fetchSorryappStatus(service);
  if (service.type === 'statuscast')   return fetchStatuscastStatus(service);
  if (service.type === 'statusio')     return fetchStatusioStatus(service);
  if (service.type === 'stripe')       return fetchStripeStatus(service);
  if (service.type === 'uptimerobot')  return fetchUptimeRobotStatus(service);
  if (service.type === 'zendesk')      return fetchZendeskStatus(service);
  return fetchStatuspageStatus(service);
}

module.exports = {
  safeJson,
  componentStatusToIndicator,
  fetchAlgoliaStatus,
  fetchAuth0Status,
  fetchAwsHealthStatus,
  fetchCachetStatus,
  fetchGoogleIncidentDashboard,
  fetchHerokuStatus,
  fetchHundStatus,
  fetchIncidentioStatus,
  fetchInstatusStatus,
  fetchPagerdutySatus,
  fetchPosthogStatus,
  fetchServiceStatus,
  fetchSignalStatus,
  fetchSite24x7Status,
  fetchSlackStatus,
  fetchSorryappStatus,
  fetchStatuspageStatus,
  fetchStatuscastStatus,
  fetchStatusioStatus,
  fetchStripeStatus,
  fetchUptimeRobotStatus,
  fetchZendeskStatus,
};
