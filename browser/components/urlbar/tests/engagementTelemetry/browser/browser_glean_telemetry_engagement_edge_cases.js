/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Test edge cases for engagement.

Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/browser/components/urlbar/tests/ext/browser/head.js",
  this
);

add_setup(async function() {
  await setup();
});

/**
 * UrlbarProvider that does not add any result.
 */
class NoResponseTestProvider extends UrlbarTestUtils.TestProvider {
  constructor() {
    super({ name: "TestProviderNoResponse ", results: [] });
    this.#deferred = PromiseUtils.defer();
  }

  get type() {
    return UrlbarUtils.PROVIDER_TYPE.HEURISTIC;
  }

  async startQuery(context, addCallback) {
    await this.#deferred.promise;
  }

  done() {
    this.#deferred.resolve();
  }

  #deferred = null;
}
const noResponseProvider = new NoResponseTestProvider();

/**
 * UrlbarProvider that adds a heuristic result immediately as usual.
 */
class AnotherHeuristicProvider extends UrlbarTestUtils.TestProvider {
  constructor({ results }) {
    super({ name: "TestProviderAnotherHeuristic ", results });
    this.#deferred = PromiseUtils.defer();
  }

  get type() {
    return UrlbarUtils.PROVIDER_TYPE.HEURISTIC;
  }

  async startQuery(context, addCallback) {
    for (const result of this._results) {
      addCallback(this, result);
    }

    this.#deferred.resolve(context);
  }

  onQueryStarted() {
    return this.#deferred.promise;
  }

  #deferred = null;
}
const anotherHeuristicProvider = new AnotherHeuristicProvider({
  results: [
    Object.assign(
      new UrlbarResult(
        UrlbarUtils.RESULT_TYPE.URL,
        UrlbarUtils.RESULT_SOURCE.OTHER_LOCAL,
        { url: "https://example.com/immediate" }
      ),
      { heuristic: true }
    ),
  ],
});

add_task(async function engagement_before_showing_results() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.searchTips.test.ignoreShowLimits", true]],
  });

  // Update chunkResultsDelayMs to delay the call to notifyResults.
  const originalChuldResultDelayMs =
    UrlbarProvidersManager._chunkResultsDelayMs;
  UrlbarProvidersManager._chunkResultsDelayMs = 1000000;

  // Add a provider that waits forever in startQuery() to avoid fireing
  // heuristicProviderTimer.
  UrlbarProvidersManager.registerProvider(noResponseProvider);

  // Add a provider that add a result immediately as usual.
  UrlbarProvidersManager.registerProvider(anotherHeuristicProvider);

  registerCleanupFunction(function() {
    UrlbarProvidersManager.unregisterProvider(noResponseProvider);
    UrlbarProvidersManager.unregisterProvider(anotherHeuristicProvider);
    UrlbarProvidersManager._chunkResultsDelayMs = originalChuldResultDelayMs;
  });

  await doTest(async browser => {
    // Try to show the results.
    const onPopupOpened = openPopup("exam");

    // Wait until starting the query and filling expected results.
    const context = await anotherHeuristicProvider.onQueryStarted();
    const query = UrlbarProvidersManager.queries.get(context);
    await BrowserTestUtils.waitForCondition(
      () =>
        query.unsortedResults.some(
          r => r.providerName === "HeuristicFallback"
        ) &&
        query.unsortedResults.some(
          r => r.providerName === anotherHeuristicProvider.name
        )
    );

    // Type Enter key before showing any results.
    await doEnter();

    assertEngagementTelemetry([
      {
        selected_result: "input_field",
        selected_result_subtype: "",
        provider: undefined,
        results: "",
        groups: "",
      },
    ]);

    // Clear the pending query to resolve the popup promise.
    noResponseProvider.done();
    // Search tips will be shown since no results were added.
    await onPopupOpened;
  });

  await SpecialPowers.popPrefEnv();
});
