'use strict';

angular.module('emission.config.dynamic', ['emission.plugin.logger',
                                           'emission.plugin.kvstore',
                                           'emission.splash.startprefs'])
.factory('DynamicConfig', function($http, $ionicPlatform,
        $window, $rootScope, $timeout, KVStore, Logger, StartPrefs) {
    const STUDY_LABEL="DYNAMIC_UI_STUDY";
    const CONFIG_PHONE_UI="config/app_ui_config";
    const LOAD_TIMEOUT = 6000; // 6000 ms = 6 seconds

    var dc = {};
    dc.UI_CONFIG_READY="UI_CONFIG_READY";
    dc.UI_CONFIG_CHANGED="UI_CONFIG_CHANGED";
    dc.isConfigReady = false;
    dc.isConfigChanged = false;

    dc.configChanged = function() {
        if (dc.isConfigChanged) {
            return Promise.resolve(dc.config);
        } else {
            return new Promise(function(resolve, reject) {
                $rootScope.on(dc.UI_CONFIG_CHANGED, (event, newConfig) => resolve(newConfig));
            });
        }
    }
    dc.configReady = function() {
        if (dc.isConfigReady) {
            Logger.log("UI_CONFIG in configReady function, resolving immediately");
            return Promise.resolve(dc.config);
        } else {
            Logger.log("UI_CONFIG in configReady function, about to create promise");
            return new Promise(function(resolve, reject) {
                Logger.log("Registering for UI_CONFIG_READY notification in dynamic_config inside the promise");
                $rootScope.$on(dc.UI_CONFIG_READY, (event, newConfig) => {
                    Logger.log("Received UI_CONFIG_READY notification in dynamic_config, resolving promise");
                    resolve(newConfig)
                });
            });
        }
    }

    var readConfigFromServer = function(label, source) {
        Logger.log("Received request to switch to "+label+" from "+source);
        if (source != "github") {
            Logger.displayError("Invalid source", "Configurations from "+source+" not supported, please contact the app developer");
            return;
        };
        const downloadURL = "https://raw.githubusercontent.com/e-mission/nrel-openpath-deploy-configs/main/configs/"+label+".nrel-op.json"
        Logger.log("Downloading data from "+downloadURL);
        return $http.get(downloadURL).then((result) => {
            Logger.log("Successfully found the "+downloadURL+", result is " + JSON.stringify(result.data).substring(0,10));
            const parsedConfig = result.data;
            const connectionURL = parsedConfig.server? parsedConfig.server.connectUrl : "dev defaults";
            Logger.log("Successfully downloaded config with version "+parsedConfig.version
                +" for "+parsedConfig.intro.translated_text.en.deployment_name
                +" and data collection URL "+connectionURL);
            return parsedConfig;
        }).catch((fetchErr) => {
            Logger.displayError("Unable to download study config", fetchErr);
        });
    }

    var loadSavedConfig = function() {
        const nativePlugin = $window.cordova.plugins.BEMUserCache;
        return nativePlugin.getDocument(CONFIG_PHONE_UI, false)
            .then((savedConfig) => {
                if (nativePlugin.isEmptyDoc(savedConfig)) {
                    Logger.log("Found empty saved ui config, returning null");
                    return null;
                } else {
                    Logger.log("Found previously stored ui config, returning it");
                    return savedConfig;
                }
            })
            .catch((err) => Logger.displayError("Unable to read saved config", err));
    }

    dc.saveAndNotifyConfigReady = function(newConfig) {
        dc.config = newConfig;
        dc.isConfigReady = true;
        console.log("Broadcasting event "+dc.UI_CONFIG_READY);
        $rootScope.$broadcast(dc.UI_CONFIG_READY, newConfig);
    }

    dc.saveAndNotifyConfigChanged = function(newConfig) {
        dc.config = newConfig;
        dc.isConfigChanged = true;
        console.log("Broadcasting event "+dc.UI_CONFIG_CHANGED);
        $rootScope.$broadcast(dc.UI_CONFIG_CHANGED, newConfig);
    }

    dc.initByUser = function(urlComponents) {
        const newStudyLabel = urlComponents.label;
        KVStore.get(STUDY_LABEL).then((existingStudyLabel) => {
            if(angular.equals(existingStudyLabel, urlComponents)) {
                Logger.log("UI_CONFIG: existing label " + JSON.stringify(existingStudyLabel) +
                    " and new one " + JSON.stringify(urlComponents), " are the same, skipping download");
                // use $scope.$apply here to be consistent with $http so we can consistently
                // skip it in the listeners
                // only loaded existing config, so it is ready, but not changed
                loadSavedConfig().then($rootScope.$apply(() => dc.saveAndNotifyConfigReady));
                return; // labels are the same
            }
            // if the labels are different
            return readConfigFromServer(urlComponents.label, urlComponents.source).then((downloadedConfig) => {
                const storeLabelPromise = KVStore.set(STUDY_LABEL, urlComponents);
                const storeConfigPromise = $window.cordova.plugins.BEMUserCache.putRWDocument(
                    CONFIG_PHONE_UI, downloadedConfig);
                const storeAll = Promise.all([storeLabelPromise, storeConfigPromise])
                .then((storeResults) => Logger.log("UI_CONFIG: Stored dynamic config successfully, result = "+JSON.stringify(storeResults)))
                .catch((storeError) => Logger.displayError("Error storing study configuration", storeError));
                // loaded new config, so it is both ready and changed
                return storeAll.then(dc.saveAndNotifyConfigChanged(downloadedConfig))
                    .then(dc.saveAndNotifyConfigReady(downloadedConfig));
            });
        });
    };
    dc.initAtLaunch = function() {
        KVStore.get(STUDY_LABEL).then((existingStudyLabel) => {
            if(existingStudyLabel) {
                // the user has already configured the app, let's cache the
                // config and notify others that we are done
                Logger.log("UI_CONFIG: finished loading config on app start");
                loadSavedConfig().then($rootScope.$apply(() => dc.saveAndNotifyConfigReady));
            }
        });
    };
    $ionicPlatform.ready().then(function() {
        dc.initAtLaunch();
    });
    return dc;
});
