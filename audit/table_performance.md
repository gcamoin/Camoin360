# Table filtering and sorting measurement

Measured on October 26, 2026 with `TablePerformance.measure.test.js`. The fixture has 5,000 deterministic rows, matching the Software Inventory and Qualified Leads request limits. Each number is the median of nine warmed calls in the Jest jsdom process on this machine, in milliseconds. This measures JavaScript filtering and sorting only, not React rendering or live browser interaction.

| Operation | Before | After | Result |
| --- | ---: | ---: | --- |
| Software Inventory: sort by subscription date, no search | 265.25 ms | 153.41 ms | 42% faster |
| Software Inventory: search `service`, sort by name | 17.35 ms | 17.86 ms | Within measurement variation |
| PE Clients: search and name sort | 1.33 ms | 1.35 ms | No change |
| PE Qualified Leads: search and newest sort | 8.37 ms | 8.47 ms | No change |

The date sort was the confirmed bottleneck. The old comparator formatted dates repeatedly for each comparison. The new code formats one sort value per matching row and reuses it for comparisons. It also calculates the lowercase search query once and skips text scanning when the query is empty. The PE paths were already fast in this fixture, so they were left alone.

`SoftwareInventory.test.js` compares the optimized result with the previous implementation for every sort column, both directions, and several search/status combinations. Run the benchmark with:

```sh
cd frontend
MEASURE_TABLE_PERFORMANCE=1 CI=true npm test -- --watch=false --runInBand src/components/TablePerformance.measure.test.js
```
