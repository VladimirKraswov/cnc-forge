// gui/renderer/src/components/GCodePanel.tsx
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

const GCodePanel = () => {
  const controller = useSelector((state) => state.machine.controller);
  const [gcode, setGcode] = useState('');

  const handleStream = () => {
    if (controller) {
      controller.streamGCode(gcode);
    }
  };

  return (
    <div>
      <TextField multiline rows={4} value={gcode} onChange={(e) => setGcode(e.target.value)} />
      <Button onClick={handleStream}>Stream GCode</Button>
    </div>
  );
};

export default GCodePanel;