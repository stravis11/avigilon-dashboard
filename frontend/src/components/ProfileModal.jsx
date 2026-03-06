import React, { useState } from 'react';
import { X, Eye, EyeOff, Settings, KeyRound, Loader } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import authService from '../services/authService';

/**
 * ProfileModal — handles two modes:
 *   'settings'  — update display name and email
 *   'password'  — change password (requires current password)
 */
const ProfileModal = ({ mode, onClose }) => {
  const { user, accessToken, updateUser } = useAuth();
  const isSettings = mode === 'settings';

  // Settings form
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSettingsSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await authService.updateProfile(accessToken, {
        name: name.trim(),
        email: email.trim(),
      });
      if (response.success) {
        updateUser(response.data);
        setSuccess(true);
        setTimeout(onClose, 1200);
      } else {
        setError(response.error || 'Failed to update profile');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await authService.changePassword(accessToken, { currentPassword, newPassword });
      if (response.success) {
        setSuccess(true);
        setTimeout(onClose, 1200);
      } else {
        setError(response.error || 'Failed to change password');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const passwordFields = [
    { label: 'Current Password', value: currentPassword, setValue: setCurrentPassword, show: showCurrent, toggle: () => setShowCurrent(s => !s), autoFocus: true },
    { label: 'New Password',     value: newPassword,     setValue: setNewPassword,     show: showNew,     toggle: () => setShowNew(s => !s),     autoFocus: false },
    { label: 'Confirm New Password', value: confirmPassword, setValue: setConfirmPassword, show: showConfirm, toggle: () => setShowConfirm(s => !s), autoFocus: false },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            {isSettings
              ? <Settings className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              : <KeyRound className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            }
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isSettings ? 'Account Settings' : 'Change Password'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={isSettings ? handleSettingsSubmit : handlePasswordSubmit}
          className="px-6 py-5 space-y-4"
        >
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 text-sm text-green-700 dark:text-green-400">
              {isSettings ? 'Profile updated successfully!' : 'Password changed successfully!'}
            </div>
          )}

          {isSettings ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Your full name"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="your@email.com"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Username: <span className="font-mono">{user?.username}</span>
                {' · '}Role: <span className="capitalize">{user?.role}</span>
              </p>
            </>
          ) : (
            <>
              {passwordFields.map(({ label, value, setValue, show, toggle, autoFocus }) => (
                <div key={label}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {label}
                  </label>
                  <div className="relative">
                    <input
                      type={show ? 'text' : 'password'}
                      value={value}
                      onChange={e => setValue(e.target.value)}
                      autoFocus={autoFocus}
                      className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={toggle}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-500 dark:text-gray-400">Minimum 8 characters.</p>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || success}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader className="h-4 w-4 animate-spin" />}
              {isSettings ? 'Save Changes' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileModal;
