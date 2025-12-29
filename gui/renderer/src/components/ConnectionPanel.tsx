// gui/renderer/src/components/ConnectionPanel.tsx
import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { setConnectionStatus, setController } from '../store/slices/machineSlice';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import { CncController } from 'cnc-forge-core';

const ConnectionPanel = () => {
  const dispatch = useDispatch();
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');

  useEffect(() => {
    window.electronAPI.getPorts().then(setPorts);
  }, []);

  const handleConnect = async () => {
    const controller = new CncController();
    try {
      await controller.connect({ port: selectedPort, baudRate: 115200 });
      dispatch(setController(controller));
      dispatch(setConnectionStatus('connected'));
      controller.startStatusPolling();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDisconnect = async () => {
    const controller = store.getState().machine.controller;
    if (controller) {
      await controller.disconnect();
      dispatch(setConnectionStatus('disconnected'));
    }
  };

  return (
    <FormControl fullWidth>
      <InputLabel>Port</InputLabel>
      <Select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
        {ports.map((port) => <MenuItem key={port.path} value={port.path}>{port.path}</MenuItem>)}
      </Select>
      <Button onClick={handleConnect}>Connect</Button>
      <Button onClick={handleDisconnect}>Disconnect</Button>
    </FormControl>
  );
};

export default ConnectionPanel;