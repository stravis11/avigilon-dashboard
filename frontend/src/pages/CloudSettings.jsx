import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, RefreshCw, AlertCircle, CheckCircle, Clock, Trash2 } from 'lucide-react';
import apiService from '../services/apiService';

const CloudSettings = () => {
  const [cloudStatus, setCloudStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiService.getCloudStatus();
      setCloudStatus(response?.data || response);
    } catch (err) {
      setError(err.message || 'Failed to load cloud status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleRefreshToken = async () => {
    try {
      setRefreshing(true);
      setRefreshResult(null);
      setError(null);
      const response = await apiService.refreshCloudToken();
      const data = response?.data || response;
      setRefreshResult({
        success: true,
        message: data.message || 'Token refresh triggered. This may take a minute.',
      });
      // Poll status after a delay to show updated token info
      setTimeout(() => loadStatus(), 60000);
    } catch (err) {
      setRefreshResult({ success: false, message: err.message || 'Failed to trigger token refresh' });
    } finally {
      setRefreshing(false);
    }
  };

  const handleClearToken = async () => {
    try {
      await apiService.clearCloudToken();
      setRefreshResult(null);
      await loadStatus();
    } catch (err) {
      setError(err.message || 'Failed to clear token');
    }
  };

  const getStatusColor = () => {
    if (!cloudStatus?.hasToken) return 'bg-gray-400';
    if (cloudStatus?.isExpired) return 'bg-orange-500';
    return 'bg-green-500';
  };

  const getStatusText = () => {
    if (!cloudStatus?.hasToken) return 'No Token';
    if (cloudStatus?.isExpired) return 'Expired';
    return 'Connected';
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-3 mb-8">
        <div className="flex items-center space-x-3">
          <Cloud className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">Cloud Connection</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Connect to Avigilon Cloud for hardware health monitoring
            </p>
          </div>
        </div>
        <button
          onClick={handleRefreshToken}
          disabled={refreshing}
          className="flex items-center space-x-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh Token'}</span>
          <span className="sm:hidden">{refreshing ? '...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Refresh result */}
      {refreshResult && (
        <div className={`mb-6 ${refreshResult.success ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'} border rounded-lg p-4 flex items-start space-x-3`}>
          {refreshResult.success ? (
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <p className={`text-sm ${refreshResult.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
            {refreshResult.message}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Token Status Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Token Status</h2>
          {loading ? (
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Checking status...</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <div className={`h-3 w-3 rounded-full ${getStatusColor()}`}></div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{getStatusText()}</span>
              </div>
              {cloudStatus?.hasToken && (
                <>
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                    <Clock className="h-4 w-4" />
                    <span>
                      Expires: {cloudStatus.expiresAtFormatted
                        ? new Date(cloudStatus.expiresAtFormatted).toLocaleString()
                        : new Date(cloudStatus.expiresAt * 1000).toLocaleString()}
                    </span>
                  </div>
                  {cloudStatus.setAt && (
                    <div className="text-sm text-gray-500 dark:text-gray-500">
                      Set at: {new Date(cloudStatus.setAt).toLocaleString()}
                    </div>
                  )}
                  <button
                    onClick={handleClearToken}
                    className="flex items-center space-x-1 mt-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Clear Token</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Info Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Automatic Token Refresh</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The cloud token is automatically refreshed every 24 hours by the token-fetcher service.
            Use the <strong>Refresh Token</strong> button above to manually trigger a refresh if needed.
            The token is valid for approximately 1 hour, but health data is cached for 24 hours after each fetch.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CloudSettings;
