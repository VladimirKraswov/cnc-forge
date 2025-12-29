// gui/renderer/src/components/ProbePanel.tsx
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

const ProbePanel = () => {
  const controller = useSelector((state) => state.machine.controller);
  const [axis, setAxis] = useState('Z');
  const [feed, setFeed] = useState(100);
  const [gridX, setGridX] = useState(100);
  const [gridY, setGridY] = useState(100);
  const [step, setStep] = useState(10);

  const handleProbe = () => {
    if (controller) {
      controller.probe(axis, feed);
    }
  };

  const handleProbeGrid = () => {
    if (controller) {
      controller.probeGrid({ x: gridX, y: gridY }, step, feed);
    }
  };

  return (
    <div>
      <TextField label="Axis" value={axis} onChange={(e) => setAxis(e.target.value)} />
      <TextField label="Feed" type="number" value={feed} onChange={(e) => setFeed(parseFloat(e.target.value))} />
      <Button onClick={handleProbe}>Probe</Button>
      <TextField label="Grid X" type="number" value={gridX} onChange={(e) => setGridX(parseFloat(e.target.value))} />
      <TextField label="Grid Y" type="number" value={gridY} onChange={(e) => setGridY(parseFloat(e.target.value))} />
      <TextField label="Step" type="number" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} />
      <Button onClick={handleProbeGrid}>Probe Grid</Button>
    </div>
  );
};

export default ProbePanel;