// gui/renderer/src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import machineReducer from './slices/machineSlice';

const store = configureStore({
  reducer: {
    machine: machineReducer,
  },
});

export default store;