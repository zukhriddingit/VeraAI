# Permission justifications

## debugger

Provides the bounded Chrome DevTools Protocol transport only for the one tab the tester explicitly
shares. The runtime rejects additional shared tabs and forbidden actions.

## tabs

Identifies, prepares, visibly groups, and revokes the one shared tab.

## tabGroups

Creates the visible dedicated Vera Search group and removes it when access is revoked.

## storage

Stores only the paired relay URL, scoped relay credential, and group color on the tester's device.

## alarms

Performs bounded relay reconnection and readiness maintenance without background housing searches.
