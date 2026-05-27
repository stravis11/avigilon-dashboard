import recordingAvailabilityService from '../services/recordingAvailabilityService.js';

export const getRecordingAvailability = async (req, res) => {
  try {
    await recordingAvailabilityService.initialize();
    res.json({ success: true, data: recordingAvailabilityService.getLatest() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const refreshRecordingAvailability = async (req, res) => {
  try {
    const data = await recordingAvailabilityService.refresh();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getRecordingAvailabilityHistory = async (req, res) => {
  try {
    await recordingAvailabilityService.initialize();
    const { serverId, format } = req.query;

    if (format === 'csv') {
      const csv = recordingAvailabilityService.toCsv(serverId || null);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="recording-availability.csv"');
      return res.send(csv);
    }

    return res.json({
      success: true,
      data: recordingAvailabilityService.getHistory(serverId || null),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
