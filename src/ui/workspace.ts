import { kindNames } from '../data/model'
import { icon, type Icon } from './icons'

const metricDefs: [string, Icon, string, string][] = [
  [
    'Active time',
    'active',
    'mint',
    'Time marked active by the presence watcher.',
  ],
  [
    'Away time',
    'away',
    'amber',
    'Time marked away by the presence watcher. Unobserved time is excluded.',
  ],
  [
    'Applications',
    'app',
    'violet',
    'Distinct foreground applications in this time range.',
  ],
  [
    'Events',
    'events',
    'blue',
    'Recorded events across all watcher lanes in this time range.',
  ],
]
const button = (id: string, name: Icon, label: string) =>
  '<button id="' +
  id +
  '" class="icon-button" aria-label="' +
  label +
  '" title="' +
  label +
  '">' +
  icon(name) +
  '</button>'
export function mountWorkspace(root: HTMLElement) {
  root.innerHTML = `
<header class="mast"><div class="brand"><img src="/mark.svg" width="33" height="33" alt=""><span>Activity<strong>Witch</strong></span></div>
<nav aria-label="Workspace"><button id="nav-timeline">${icon('timeline')}Timeline</button><button id="nav-events">${icon('list')}Event log</button></nav>
<div class="mast-right"><span class="readonly">${icon('lock', 13)}Read-only</span><button id="connection" title="ActivityWatch connection details"><i class="status-dot"></i><span id="status">Connecting</span>${icon('down', 12)}</button></div></header>
<main>
<div class="workspace-head"><div><h1 id="page-title">Activity timeline</h1><div id="date-caption" class="caption"></div></div>
<div class="tools"><div class="period-toggle" aria-label="Time period"><button id="period-day">Day</button><button id="period-week">Week</button></div><label class="device field">${icon('monitor')}<select id="device" aria-label="Device"><option>Local device</option></select>${icon('down', 12)}</label>
<div class="date-group">${button('prev', 'left', 'Previous day')}<button class="date-trigger" id="open-date" aria-expanded="false">${icon('calendar')}<span id="date-label">Today</span></button>${button('next', 'right', 'Next day')}
<div id="date-pop" class="popover" hidden><label for="date-input">Go to date</label><input type="date" id="date-input"><button id="today" class="soft">Today</button></div></div>
${button('reload', 'refresh', 'Refresh ActivityWatch data')}</div></div>
<div id="notice" role="status" hidden></div>
<div id="timeline-view">
<section class="metrics" aria-label="Activity summary">${metricDefs.map(([label, name, tone, help], i) => '<div class="metric ' + tone + '" title="' + help + '"><div class="metric-label"><span class="metric-icon">' + icon(name, 15) + '</span>' + label + '</div><div class="metric-base"><strong id="metric-' + i + '">—</strong><svg id="spark-' + i + '" viewBox="0 0 82 24" aria-hidden="true"></svg></div></div>').join('')}</section>
<section class="map-panel"><div class="map-head"><h2>${icon('layers', 18)}<span id="map-title">Week map</span></h2><div class="map-actions"><label id="week-source-field" class="source-select"><select id="week-source" aria-label="Week map activity source"></select>${icon('down', 12)}</label><button id="reset-range" hidden>${icon('reset', 13)}Reset zoom</button><div class="segment" id="day-modes"><button id="recorded">Recorded hours</button><button id="full-day">24 hours</button></div></div></div>
<div id="map"></div><div id="week-map"></div><div class="map-foot"><div id="legend"></div><span class="gesture" id="map-hint"></span></div></section>
</div>
<div id="panels">
<section class="panel usage"><div class="panel-head"><h2>${icon('bars', 18)}Application usage</h2><span class="count" id="apps-count">0</span></div>
<div class="usage-cols"><span>Application</span><span>Window time</span></div><div id="ranking"></div></section>
<section class="panel stream"><div class="panel-head"><h2>${icon('list', 18)}<span id="stream-title">Event stream</span><span class="count" id="event-count">0</span></h2><label class="source-select"><select id="source" aria-label="Event source"><option value="">All sources</option>${Object.entries(
    kindNames,
  )
    .map(
      ([value, name]) => '<option value="' + value + '">' + name + '</option>',
    )
    .join('')}</select>${icon('down', 12)}</label></div>
<div class="search-line"><label class="search field">${icon('search', 15)}<input id="search" type="text" placeholder="Find an event…" aria-label="Find an event">${button('clear-search', 'close', 'Clear search')}</label><button id="app-filter" class="chip" hidden></button></div>
<div class="event-cols"><span>Time</span><span>Activity</span><span class="source-cell">Source</span><span>Duration</span></div>
<div id="list-wrap"><div id="list"></div><div id="list-empty" class="empty" hidden></div></div></section>
</div></main>
<footer><span>${icon('server', 13)}<span id="foot-server">ActivityWatch</span></span><span id="foot-range"></span></footer>
<dialog id="dialog"><div class="dialog-head"><h2 id="dialog-title"></h2>${button('close-dialog', 'close', 'Close dialog')}</div><div id="dialog-body"></div></dialog>`
}
