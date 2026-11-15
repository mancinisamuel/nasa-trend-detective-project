import type { MessageKey } from "./en";

// UI texts, German. The type forces exactly the keys of en.ts.
export const de: Record<MessageKey, string> = {
  "app.title": "Trend Detective",
  "globe.back": "Zurück",
  "globe.level.continents": "Kontinente",
  "globe.level.countries": "Länder",
  "globe.level.regions": "Verwaltungsregionen",
  "globe.ariaLabel": "Interaktiver Globus",
  "globe.webglFallback":
    "Der 3D-Globus braucht WebGL, das in diesem Browser nicht verfügbar ist.",
  "globe.backToGlobe": "Zurück zum Globus",
  // UI-DESIGN-2: English until TD Texter delivers the German wording.
  "globe.loading": "Globe View loading...",
  // E-35: English until TD Texter delivers the German wording.
  "globe.path.globe": "Globe",
  "globe.countryMap.ariaLabel": "Karte des gewählten Landes",
  "globe.countryMap.showNeighbor": "Karte anzeigen",
  // E-32: English until TD Texter delivers the German wording.
  "map.previouslySelected": "Previously selected",
  // Floor-plan placeholders (E-25), copied verbatim from the floor plan; German wording by TD Texter.
  "layout.searchbar": "*Searchbar*",
  "layout.sidePanel": "*Side Panel*",
  "layout.timeframe.label": "Set a timeframe (from - to)",
  // Bottom sheet (E-30, test purposes): neutral placeholders until TD Texter delivers copy.
  "layout.graphPlaceholder": "*Graphs*",
  // Label of the bottom-sheet handle (opens the trend result).
  "layout.sheetHandle": "Ergebnisse",
  // Chevron above the timeline: expands the collapsed globe (UI-LAYOUT); copy by TD Texter.
  "layout.expandGlobe": "Globus wieder in voller Größe anzeigen",
  // F-CALC bottom sheet (copy by TD Texter).
  "compare.demoBanner":
    "Demo-Modus: Das sind synthetische Werte, keine NASA-Messungen.",
  "compare.loading": "Daten werden geladen…",
  "compare.error": "Die Daten konnten nicht geladen werden.",
  "compare.retry": "Erneut versuchen",
  "compare.stale":
    "Dieses Ergebnis ist eventuell veraltet oder gehört noch zu deiner vorherigen Auswahl.",
  "timeline.start": "Startjahr",
  "timeline.end": "Endjahr",
  "timeline.apply": "Gewählten Zeitraum analysieren",
  "trend.slope": "Trend",
  "trend.perDecade": "pro Jahrzehnt",
  "trend.ci95": "95-%-Konfidenzintervall",
  "trend.pValue": "p-Wert",
  "trend.significance": "Einordnung",
  "trend.significance.positive_trend":
    "Steigender Trend (statistisch klar unter den Modellannahmen)",
  "trend.significance.negative_trend":
    "Fallender Trend (statistisch klar unter den Modellannahmen)",
  "trend.significance.no_clear_trend": "Kein statistisch klarer linearer Trend",
  "trend.years": "Verwendete Jahre",
  "trend.period": "Verwendeter Zeitraum",
  "trend.missingBaseline":
    "Die Basisperiode ist unvollständig, deshalb lassen sich keine Abweichungen berechnen. Angezeigt werden die absoluten Werte.",
  "trend.insufficientData":
    "Zu wenige vollständige Jahre für einen Trend. Nötig sind mindestens 3 aufeinanderfolgende vollständige Jahre.",
  "layout.search": "Suchen",
  // TL-2 timeline v2 (copy by TD Texter).
  "timeline.calculate": "Berechnen",
  "timeline.addMonth": "Monat hinzufügen",
  "timeline.info": "Infos zum gewählten Zeitraum",
  // D-05: short-period note under the trend (fewer than 10 years).
  "trend.shortPeriod":
    "Kurzer Zeitraum unter 10 Jahren. Dieser Trend ist sehr unsicher, und das Konfidenzintervall ist meist breit.",
  // UI-AT: variable select and area-mean note; placeholders until TD Texter delivers copy.
  "compare.variable": "Variable",
  "compare.group.monthly": "Jahreswerte (aus Monatsdaten)",
  // Client-side JSON/CSV of the shown series (UI-EXPORT).
  "export.label": "Angezeigte Daten herunterladen",
  "export.json": "JSON",
  "export.csv": "CSV (für Tabellen)",
  // Excel report menu and workbook labels (UI-XLSX). Sheet names: max. 31 characters, none of : \\ / ? * [ ].
  "export.button": "Exportieren",
  "export.excel": "Excel-Bericht (.xlsx)",
  "export.menu": "Exportformate",
  "export.busy": "Excel-Bericht wird erstellt…",
  "export.excel.error": "Der Excel-Bericht konnte nicht erstellt werden.",
  "export.sheet.overview": "Übersicht",
  "export.sheet.extremes": "Extremwerte",
  "export.sheet.method": "Methode",
  "export.col.year": "Jahr",
  "export.col.value": "Wert",
  "export.col.trendLine": "Trendlinie",
  "export.col.metric": "Kennzahl",
  "export.col.ciLow": "95-%-KI, Untergrenze",
  "export.col.ciHigh": "95-%-KI, Obergrenze",
  "export.col.record": "Rekord",
  "export.col.date": "Datum",
  "export.field.location": "Standort",
  "export.field.latitude": "Breitengrad",
  "export.field.longitude": "Längengrad",
  "export.field.period": "Zeitraum",
  "export.field.source": "Quelle",
  "export.field.retrievedAt": "Abgerufen am",
  "export.field.unit": "Einheit",
  "export.field.significant": "Statistisch klarer Trend",
  "export.significant.yes": "Ja",
  "export.significant.no": "Nein",
  "export.method.olsHac":
    "Linearer Trend, geschätzt mit der Methode der kleinsten Quadrate (OLS) auf Jahreswerten, mit HAC-Standardfehlern (Newey-West), die die Abhängigkeit benachbarter Jahre berücksichtigen. Ein Trend beschreibt die Veränderung im gewählten Zeitraum, nicht ihre Ursache. Die Werte stammen aus NASA-POWER-Rasterzellen von etwa 50 km (für Österreich ein flächengewichtetes Mittel mehrerer Zellen), nicht von Wetterstationen.",
  "export.method.thresholds": "Schwellenwerte",
  "export.method.analysisVersion": "Analyseversion",
  "export.method.minYears": "Mindestanzahl vollständiger Jahre",
  "export.method.hacLags": "HAC-Lags (maxlags)",
  "export.method.confidenceLevel": "Konfidenzniveau",
  "export.records": "Rekorde",
  // Spatial provenance in exports (UI-EXPORT-SPATIAL); placeholders until TD Texter delivers copy.
  "export.field.spatialMethod": "Räumliche Methode",
  "export.spatial.areaWeightedGrid":
    "Flächengewichtetes Mittel aus {count} NASA-POWER-Rasterzellen (Randzellen zählen nur mit ihrem Anteil im Bundesland)",
  "export.spatial.areaWeightedStates":
    "Flächengewichtetes Mittel der 9 Bundesländer",
  "export.spatial.gridPoint": "Einzelner Rasterpunkt (Zelle von etwa 50 km)",
  "export.spatial.capitalPoint": "Rasterzelle der Hauptstadt (etwa 50 km)",
  "export.field.capitalName": "Hauptstadt",
  "trend.areaMean.grid":
    "Mittelwert über das ganze Gebiet, gewichtet nach dem Anteil jeder NASA-Rasterzelle (etwa 50 km) darin. An einem bestimmten Ort können die Werte abweichen.",
  "trend.areaMean.states":
    "Mittelwert aller Bundesländer bzw. Bundesstaaten, gewichtet nach ihrer Fläche. An einem bestimmten Ort können die Werte abweichen.",
  // UI-UNIT: display labels for catalog units (variable.unit).
  "unit.degC": "°C",
  "unit.mm_year": "mm/Jahr",
  "unit.percent": "%",
  "unit.m_s": "m/s",
  // Region sidebar (T-REGION): municipalities and districts of an Austrian state.
  "region.tab.municipalities": "Gemeinden",
  "region.tab.districts": "Bezirke",
  "region.search.municipalities": "Gemeinden suchen",
  "region.search.districts": "Bezirke suchen",
  "region.sort.az": "A–Z",
  "region.sort.za": "Z–A",
  "region.sort.ariaLabel": "Sortierung ändern",
  "region.empty": "Keine Treffer.",
  "region.loading": "Regionen werden geladen…",
  "region.error": "Die Regionsdaten konnten nicht geladen werden.",
  "region.retry": "Erneut versuchen",
  // Federal-state level (T-REGION-2): title and aria text; the state name is prefixed in code.
  "region.level.states": "Bundesländer",
  "region.countryMap.openState": "Bundesland öffnen",
  // USA state level (T-REGION-3): counties tab, hint for county equivalents, no municipality data.
  "region.tab.counties": "Counties",
  "region.tab.counties.hint":
    "Einschließlich gleichwertiger Einheiten wie Parishes (Louisiana) und Boroughs (Alaska).",
  "region.search.counties": "Counties suchen",
  "region.municipalities.unavailable":
    "Für dieses Land sind keine Gemeindedaten verfügbar.",
  "region.level.usStates": "Bundesstaaten",
  "region.countryMap.openUsState": "Bundesstaat öffnen",
  // Country without a state level (T-REGION-4, E-49).
  "region.unsupported":
    "Für dieses Land ist keine regionale Gliederung verfügbar.",
  // Continent where no country has a state level (T-REGION-5, E-49b).
  "region.unsupportedContinent":
    "Für kein Land dieses Kontinents ist eine regionale Gliederung verfügbar.",
  // Search field over the globe (E-52b). search.type.* are read by screen readers only.
  "search.placeholder": "Ort oder Region suchen",
  "search.ariaLabel": "Ort oder Region suchen",
  "search.resultsAriaLabel": "Suchergebnisse",
  "search.minChars": "Mindestens 2 Zeichen eingeben.",
  "search.loading": "Suche läuft…",
  "search.empty": "Keine Treffer.",
  "search.error": "Die Suche ist fehlgeschlagen.",
  "search.type.municipality": "Gemeinde",
  "search.type.district": "Bezirk",
  "search.type.county": "County",
  "search.type.state": "Bundesland",
  "search.type.usState": "Bundesstaat",
  // Chart legend in the results card (UI-CHART). NASA POWER values are model and satellite estimates, so not "measured".
  "chart.legend.observations": "Jahreswerte",
  "chart.legend.trend": "Linearer Trend",
  // UI-DESIGN-3: English until TD Texter delivers the German wording.
  "chart.info": "About this chart",
  // UI-DESIGN-4: English until TD Texter delivers the German wording.
  "toast.close": "Close",
  "unit.days": "Tage",
  "unit.mm": "mm",
  "unit.mm_day": "mm/Tag",
  "unit.mj_m2": "MJ/m²",
  // Extremes section in the results card (UI-EXTREMES). Threshold values and years are appended by the UI from the API.
  // extremes.note: data caveats (grid cell, solar time, wind not a gust); wired up by TD UI.
  "extremes.note":
    "Die Werte gelten für eine Rasterzelle von etwa 50 km, nicht für eine Wetterstation. Tage zählen nach lokaler Sonnenzeit. Wind ist der stärkste Stundenmittelwert in 10 m Höhe, keine Böe.",
  "extremes.loading": "Extremwerte werden geladen…",
  "extremes.capitalNote": "Werte für {name} (Hauptstadt)",
  "extremes.capitalNote.unnamed": "Werte für die Hauptstadt",
  "extremes.capitalInfo":
    "Die Extremwerte eines Bundeslands oder Bundesstaats stammen aus der NASA-POWER-Rasterzelle der Hauptstadt, etwa 50 km groß. Für Werte näher an einem bestimmten Ort diesen Ort direkt wählen.",
  "extremes.regionUnsupported":
    "Für diese Region gibt es keine Extremwerte. Bitte einen einzelnen Bundesstaat oder ein Bundesland wählen.",
  "extremes.error": "Die Extremwerte konnten nicht geladen werden.",
  "extremes.retry": "Erneut versuchen",
  "extremes.record.hottest_day": "Heißester Tag",
  "extremes.record.wettest_day": "Regenreichster Tag",
  "extremes.record.max_hourly_wind": "Stärkster Stundenwind",
  "extremes.record.noValue": "Kein Wert",
  "extremes.group.heat": "Hitze",
  "extremes.group.cold": "Kälte",
  "extremes.group.precipitation": "Niederschlag",
  "extremes.group.wind": "Wind",
  "extremes.group.sun": "Sonne",
  "extremes.metric.hot_days": "Heiße Tage",
  "extremes.metric.tropical_nights": "Tropennächte",
  "extremes.metric.longest_heatwave": "Längste Folge heißer Tage",
  "extremes.metric.hottest_day": "Heißester Tag des Jahres",
  "extremes.metric.frost_days": "Frosttage",
  "extremes.metric.ice_days": "Eistage",
  "extremes.metric.wettest_day": "Regenreichster Tag des Jahres",
  "extremes.metric.wet_days": "Regentage",
  "extremes.metric.heavy_rain_days": "Starkregentage",
  "extremes.metric.longest_dry_spell": "Längste Trockenphase",
  "extremes.metric.max_hourly_wind": "Stärkster Stundenwind des Jahres",
  "extremes.metric.radiation_sum": "Jährliche Sonneneinstrahlung",
  "extremes.threshold.hot_day":
    "Heißer Tag: Tageshöchsttemperatur von mindestens",
  "extremes.threshold.tropical_night":
    "Tropennacht: Tagestiefsttemperatur von mindestens",
  "extremes.threshold.frost_day": "Frosttag: Tagestiefsttemperatur unter",
  "extremes.threshold.ice_day": "Eistag: Tageshöchsttemperatur unter",
  "extremes.threshold.wet_day":
    "Regentag: Niederschlag (Regen oder Schnee) von mindestens",
  "extremes.threshold.heavy_rain": "Starkregentag: Niederschlag von mindestens",
  "extremes.threshold.dry_day":
    "Längste Folge aufeinanderfolgender Tage mit Niederschlag unter",
  "extremes.threshold.radiation_from":
    "Am Boden ankommende Sonnenstrahlung, über das Jahr summiert. Die Datenquelle kann sich im Lauf der Zeit geändert haben, deshalb sind langfristige Änderungen unsicherer. Werte ab",
  // City result card in the side panel (E-67); one term throughout: "statistisch klar" (95-%-Intervall schließt null aus).
  "result.changeLocation": "Ort ändern",
  "result.calculateHint":
    "Klicke auf „Berechnen“, um den Trend für diesen Ort zu sehen.",
  // English until TD Texter delivers the German wording.
  "result.calculateFor": "Calculate for {name}",
  // UI-DESIGN-15: same place, new period after a calculation (wording by Yannik; de still English).
  "result.recalculateFor": "Recalculate for {name}",
  "result.verdict.positive_trend": "Statistisch klarer Anstieg",
  "result.verdict.negative_trend": "Statistisch klarer Rückgang",
  "result.verdict.no_clear_trend": "Kein statistisch klarer Trend",
  "result.assessment.positive_trend": "Steigender Trend",
  "result.assessment.negative_trend": "Fallender Trend",
  "result.assessment.hint": "(statistisch klar unter den Modellannahmen)",
  "error.notFound.title": "Seite nicht gefunden",
  "error.notFound.home": "Zur Startseite",
  "error.boundary.title": "Etwas ist schiefgelaufen.",
  "error.boundary.reload": "Neu laden",
  "error.server":
    "Auf dem Server ist etwas schiefgelaufen. Bitte versuche es später erneut.",
  // How-to modal (E-79/E-81); Wortlaut von TD Texter.
  "howTo.button": "Anleitung",
  "howTo.title": "So nutzt du Trend Detective",
  "howTo.close": "Schließen",
  // UI-DESIGN-15: still English until TD Texter translates it.
  "howTo.restart": "Restart animation",
  "howTo.step1": "Ort wählen",
  "howTo.step1Hint":
    "Globus oder Karte anklicken oder suchen. Für Details zoomen.",
  "howTo.step2": "Variable und Zeitraum wählen",
  "howTo.step2Hint": "Rechts die Variable, unten die Jahre, dann „Calculate“.",
  "howTo.step3": "Trend ablesen",
  "howTo.step3Hint":
    "Diagramm, Trend pro Jahrzehnt, Qualitätshinweis und Export.",
  // Demo-Präsentation unter /demo (E-84). Button-Text von Samuel; Folien-Alt vorläufig.
  "demo.backToApp": "Zur Webapplikation",
  "demo.slideAlt": "Präsentationsfolie {n} von 5",
};
