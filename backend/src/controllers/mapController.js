import arcgisMapService from '../services/arcgisMapServiceInstance.js';

export const getCameraMap = async (req, res) => {
  try {
    const data = await arcgisMapService.getCameraMap();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const refreshCameraMap = async (req, res) => {
  try {
    const data = await arcgisMapService.getCameraMap({ forceRefresh: true });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
