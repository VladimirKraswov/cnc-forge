// gui/renderer/src/store/slices/machineSlice.ts
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  connectionStatus: 'disconnected',
  controller: null,
  status: { state: 'Unknown', position: { x: 0, y: 0, z: 0 }, feed: 0 },
};

const machineSlice = createSlice({
  name: 'machine',
  initialState,
  reducers: {
    setConnectionStatus: (state: { connectionStatus: any; }, action: { payload: any; }) => {
      state.connectionStatus = action.payload;
    },
    setController: (state: { controller: any; }, action: { payload: any; }) => {
      state.controller = action.payload;
    },
    setStatus: (state: { status: any; }, action: { payload: any; }) => {
      state.status = action.payload;
    },
  },
});

export const { setConnectionStatus, setController, setStatus } = machineSlice.actions;
export default machineSlice.reducer;