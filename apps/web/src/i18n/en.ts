// UI texts, English (default locale). en.ts defines the set of keys; de.ts must provide the same keys.
// The app currently shows only the 3D globe. Demo data must be labelled as demo once the globe shows data.
// Texts contain no placeholders. Names, numbers and units are added by the UI.
export const en = {
  "app.title": "Trend Detective",
  "globe.back": "Back",
  "globe.level.continents": "Continents",
  "globe.level.countries": "Countries",
  "globe.level.regions": "Administrative regions",
  "globe.ariaLabel": "Interactive globe",
  "globe.webglFallback":
    "The 3D globe needs WebGL, which is not available in this browser.",
  "globe.backToGlobe": "Back to globe",
  // UI-DESIGN-2: loader when returning to the globe view; wording by Yannik.
  "globe.loading": "Globe View loading...",
  // Path segment for the whole globe (E-35); neutral until TD Texter delivers copy.
  "globe.path.globe": "Globe",
  "globe.countryMap.ariaLabel": "Map of the selected country",
  "globe.countryMap.showNeighbor": "Show map",
  // Label on the country shown just before a neighbour switch (E-32).
  "map.previouslySelected": "Previously selected",
  "layout.searchbar": "*Searchbar*",
  "layout.sidePanel": "*Side Panel*",
  "layout.timeframe.label": "Set a timeframe (from - to)",
  // Bottom sheet (E-30, test purposes): neutral area-weighted state points (backend austria.py).
  "layout.graphPlaceholder": "*Graphs*",
  // Label of the bottom-sheet handle (opens the trend result).
  "layout.sheetHandle": "Results",
  // Chevron above the timeline: expands the collapsed globe (UI-LAYOUT); copy by TD Texter.
  "layout.expandGlobe": "Show the globe at full size",
  // F-CALC bottom sheet (copy by TD Texter).
  "compare.demoBanner":
    "Demo mode: these are synthetic values, not NASA measurements.",
  "compare.loading": "Loading data…",
  "compare.error": "The data could not be loaded.",
  "compare.retry": "Try again",
  "compare.stale":
    "This result may be out of date or may belong to your previous selection.",
  "timeline.start": "Start year",
  "timeline.end": "End year",
  "timeline.apply": "Analyze selected period",
  "trend.slope": "Trend",
  "trend.perDecade": "per decade",
  "trend.ci95": "95% confidence interval",
  "trend.pValue": "p-value",
  "trend.significance": "Assessment",
  "trend.significance.positive_trend":
    "Upward trend (statistically clear under the model assumptions)",
  "trend.significance.negative_trend":
    "Downward trend (statistically clear under the model assumptions)",
  "trend.significance.no_clear_trend": "No statistically clear linear trend",
  "trend.years": "Years used",
  "trend.period": "Period used",
  "trend.missingBaseline":
    "The baseline period is incomplete, so anomalies cannot be calculated. Absolute values are shown instead.",
  "trend.insufficientData":
    "Not enough complete years for a trend. At least 3 consecutive complete years are needed.",
  // Collapsed search bar while the sheet is open (E-35); placeholder icon, no function yet.
  "layout.search": "Search",
  // TL-2 timeline v2 (copy by TD Texter).
  "timeline.calculate": "Calculate",
  "timeline.addMonth": "Add month",
  "timeline.info": "About the selected period",
  // D-05: short-period note under the trend (fewer than 10 years).
  "trend.shortPeriod":
    "Short period of fewer than 10 years. This trend is very uncertain, and the confidence interval is usually wide.",
  // UI-AT: variable select and area-mean note; area-weighted state points (backend austria.py).
  "compare.variable": "Variable",
  "compare.group.monthly": "Annual values (from monthly data)",
  // Client-side JSON/CSV of the shown series (UI-EXPORT).
  "export.label": "Download the data shown",
  "export.json": "JSON",
  "export.csv": "CSV (for spreadsheets)",
  // Excel report menu and workbook labels (UI-XLSX). Sheet names: max. 31 characters, none of : \\ / ? * [ ].
  "export.button": "Export",
  "export.excel": "Excel report (.xlsx)",
  "export.menu": "Export formats",
  "export.busy": "Preparing the Excel report…",
  "export.excel.error": "The Excel report could not be created.",
  "export.sheet.overview": "Overview",
  "export.sheet.extremes": "Extremes",
  "export.sheet.method": "Method",
  "export.col.year": "Year",
  "export.col.value": "Value",
  "export.col.trendLine": "Trend line",
  "export.col.metric": "Metric",
  "export.col.ciLow": "95% CI, lower bound",
  "export.col.ciHigh": "95% CI, upper bound",
  "export.col.record": "Record",
  "export.col.date": "Date",
  "export.field.location": "Location",
  "export.field.latitude": "Latitude",
  "export.field.longitude": "Longitude",
  "export.field.period": "Period",
  "export.field.source": "Source",
  "export.field.retrievedAt": "Retrieved at",
  "export.field.unit": "Unit",
  "export.field.significant": "Statistically clear trend",
  "export.significant.yes": "Yes",
  "export.significant.no": "No",
  "export.method.olsHac":
    "Linear trend fitted with ordinary least squares (OLS) on annual values, with HAC (Newey-West) standard errors that allow for correlation between neighbouring years. A trend describes change over the chosen period, not its cause. Values come from NASA POWER grid cells of about 50 km (for Austria, an area-weighted mean of several cells), not from weather stations.",
  "export.method.thresholds": "Thresholds",
  "export.method.analysisVersion": "Analysis version",
  "export.method.minYears": "Minimum number of complete years",
  "export.method.hacLags": "HAC lags (maxlags)",
  "export.method.confidenceLevel": "Confidence level",
  "export.records": "Records",
  // Spatial provenance in exports (UI-EXPORT-SPATIAL); placeholders until TD Texter delivers copy.
  "export.field.spatialMethod": "Spatial method",
  "export.spatial.areaWeightedGrid":
    "Area-weighted mean of {count} NASA POWER grid cells (cells on the border count only with the part inside the state)",
  "export.spatial.areaWeightedStates":
    "Area-weighted mean of the 9 federal states",
  "export.spatial.gridPoint": "Single grid point (cell of about 50 km)",
  "export.spatial.capitalPoint": "Grid cell of the capital (about 50 km)",
  "export.field.capitalName": "Capital",
  "trend.areaMean.grid":
    "Average over the whole state, weighted by how much of each NASA grid cell (about 50 km) lies inside it. Values at a specific place can differ.",
  "trend.areaMean.states":
    "Average of all states, weighted by their area. Values at a specific place can differ.",
  // UI-UNIT: display labels for catalog units (variable.unit).
  "unit.degC": "°C",
  "unit.mm_year": "mm/year",
  "unit.percent": "%",
  "unit.m_s": "m/s",
  // Region sidebar (T-REGION): municipalities and districts of an Austrian state.
  "region.tab.municipalities": "Municipalities",
  "region.tab.districts": "Districts",
  "region.search.municipalities": "Search municipalities",
  "region.search.districts": "Search districts",
  "region.sort.az": "A–Z",
  "region.sort.za": "Z–A",
  "region.sort.ariaLabel": "Change sort order",
  "region.empty": "No matches.",
  "region.loading": "Loading regions…",
  "region.error": "The regional data could not be loaded.",
  "region.retry": "Try again",
  // Federal-state level (T-REGION-2): title and aria text; the state name is prefixed in code.
  "region.level.states": "Federal states",
  "region.countryMap.openState": "Open federal state",
  // USA state level (T-REGION-3): counties tab, hint for county equivalents, no municipality data.
  "region.tab.counties": "Counties",
  "region.tab.counties.hint":
    "Includes county equivalents such as parishes (Louisiana) and boroughs (Alaska).",
  "region.search.counties": "Search counties",
  "region.municipalities.unavailable":
    "No municipality data is available for this country.",
  "region.level.usStates": "States",
  "region.countryMap.openUsState": "Open state",
  // Country without a state level (T-REGION-4, E-49).
  "region.unsupported": "No regional breakdown is available for this country.",
  // Continent where no country has a state level (T-REGION-5, E-49b).
  "region.unsupportedContinent":
    "No regional breakdown is available for any country on this continent.",
  // Search field over the globe (E-52b). search.type.* are read by screen readers only.
  "search.placeholder": "Search for a place or region",
  "search.ariaLabel": "Search for a place or region",
  "search.resultsAriaLabel": "Search results",
  "search.minChars": "Type at least 2 characters.",
  "search.loading": "Searching…",
  "search.empty": "No matches.",
  "search.error": "The search failed.",
  "search.type.municipality": "Municipality",
  "search.type.district": "District",
  "search.type.county": "County",
  "search.type.state": "Federal state",
  "search.type.usState": "State",
  // Chart legend in the results card (UI-CHART). NASA POWER values are model and satellite estimates, so not "measured".
  "chart.legend.observations": "Annual values",
  "chart.legend.trend": "Linear trend",
  // UI-DESIGN-3: name of the info button over the chart; placeholder until TD Texter words it.
  "chart.info": "About this chart",
  // UI-DESIGN-4: close button of a toast.
  "toast.close": "Close",
  "unit.days": "days",
  "unit.mm": "mm",
  "unit.mm_day": "mm/day",
  "unit.mj_m2": "MJ/m²",
  // Extremes section in the results card (UI-EXTREMES). Threshold values and years are appended by the UI from the API.
  // extremes.note: data caveats (grid cell, solar time, wind not a gust); wired up by TD UI.
  "extremes.note":
    "Values are for a grid cell of about 50 km, not a weather station. Days are counted in local solar time. Wind is the strongest hourly mean wind at 10 m, not a gust.",
  "extremes.loading": "Loading extremes…",
  // UI-EXTCAP: state extremes from the capital grid point; placeholder for TD Texter.
  "extremes.capitalNote": "Values for {name} (capital)",
  "extremes.capitalNote.unnamed": "Values for the capital",
  "extremes.capitalInfo":
    "Extremes for a state come from the NASA POWER grid cell of its capital, about 50 km across. For values closer to a specific place, choose that place directly.",
  "extremes.regionUnsupported":
    "Extremes are not available for this region. Please choose a single state.",
  "extremes.error": "The extremes could not be loaded.",
  "extremes.retry": "Try again",
  "extremes.record.hottest_day": "Hottest day",
  "extremes.record.wettest_day": "Wettest day",
  "extremes.record.max_hourly_wind": "Strongest hourly wind",
  "extremes.record.noValue": "No value",
  "extremes.group.heat": "Heat",
  "extremes.group.cold": "Cold",
  "extremes.group.precipitation": "Precipitation",
  "extremes.group.wind": "Wind",
  "extremes.group.sun": "Sun",
  "extremes.metric.hot_days": "Hot days",
  "extremes.metric.tropical_nights": "Tropical nights",
  "extremes.metric.longest_heatwave": "Longest run of hot days",
  "extremes.metric.hottest_day": "Hottest day of the year",
  "extremes.metric.frost_days": "Frost days",
  "extremes.metric.ice_days": "Ice days",
  "extremes.metric.wettest_day": "Wettest day of the year",
  "extremes.metric.wet_days": "Rain days",
  "extremes.metric.heavy_rain_days": "Heavy rain days",
  "extremes.metric.longest_dry_spell": "Longest dry spell",
  "extremes.metric.max_hourly_wind": "Strongest hourly wind of the year",
  "extremes.metric.radiation_sum": "Annual solar radiation",
  "extremes.threshold.hot_day":
    "Hot day: daily maximum temperature of at least",
  "extremes.threshold.tropical_night":
    "Tropical night: daily minimum temperature of at least",
  "extremes.threshold.frost_day": "Frost day: daily minimum temperature below",
  "extremes.threshold.ice_day": "Ice day: daily maximum temperature below",
  "extremes.threshold.wet_day":
    "Rain day: precipitation (rain or snow) of at least",
  "extremes.threshold.heavy_rain": "Heavy rain day: precipitation of at least",
  "extremes.threshold.dry_day":
    "Longest run of consecutive days with precipitation below",
  "extremes.threshold.radiation_from":
    "Solar radiation reaching the ground, summed over the year. The data source may have changed over time, so long-term changes are less certain. Values from",
  // City result card in the side panel (E-67); one term throughout: "statistically clear" (95% interval excludes zero).
  "result.changeLocation": "Change location",
  "result.calculateHint": "Press Calculate to see the trend for this place.",
  // UI-DESIGN-7/8: Calculate button in the side panel; wording from Yannik, {name} is the place.
  "result.calculateFor": "Calculate for {name}",
  // UI-DESIGN-15: same place, new period after a calculation (wording by Yannik; de still English).
  "result.recalculateFor": "Recalculate for {name}",
  "result.verdict.positive_trend": "Statistically clear increase",
  "result.verdict.negative_trend": "Statistically clear decrease",
  "result.verdict.no_clear_trend": "No statistically clear trend",
  "result.assessment.positive_trend": "Upward trend",
  "result.assessment.negative_trend": "Downward trend",
  "result.assessment.hint": "(statistically clear under the model assumptions)",
  // UI-ERR: unknown URL, render crash, and API 500/502. Placeholder copy for TD Texter.
  "error.notFound.title": "Page not found",
  "error.notFound.home": "Back to the start page",
  "error.boundary.title": "Something went wrong.",
  "error.boundary.reload": "Reload",
  "error.server": "Something went wrong on the server. Please try again later.",
  // How-to modal (E-79/E-81); wording from TD Texter.
  "howTo.button": "How to",
  "howTo.title": "How to use Trend Detective",
  "howTo.close": "Close",
  // UI-DESIGN-15: round button over the demo video, starts it from the beginning.
  "howTo.restart": "Restart animation",
  "howTo.step1": "Pick a place",
  "howTo.step1Hint": "Click the globe or map, or search. Zoom in to go deeper.",
  "howTo.step2": "Set variable and period",
  "howTo.step2Hint":
    "Variable on the right, years at the bottom, then Calculate.",
  "howTo.step3": "Read the trend",
  "howTo.step3Hint": "Chart, trend per decade, quality note and export.",
  // Demo presentation at /demo (E-84/E-85).
  "demo.backToApp": "Go to the web app",
  "demo.slideAlt": "Presentation slide {n} of 5",
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en;
