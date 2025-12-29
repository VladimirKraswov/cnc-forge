// gui/renderer/src/components/JogPanel.tsx
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

interface RootState {
  machine: {
    controller: any;
  };
}

const JogPanel = () => {
  const controller = useSelector((state: RootState) => state.machine.controller);
  const [distance, setDistance] = useState(10);
  const [feed, setFeed] = useState(100);

  const handleJog = (axis: string, dir: number) => {
    if (controller) {
      const axes = { [axis.toLowerCase()]: dir * distance };
      controller.jog(axes, feed);
    }
  };

  return (
    <div>
      <TextField label="Distance" type="number" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value))} />
      <TextField label="Feed" type="number" value={feed} onChange={(e) => setFeed(parseFloat(e.target.value))} />
      <Button onClick={() => handleJog('X', 1)}>X+</Button>
      <Button onClick={() => handleJog('X', -1)}>X-</Button>
      <Button onClick={() => handleJog('Y', 1)}>Y+</Button>
      <Button onClick={() => handleJog('Y', -1)}>Y-</Button>
      <Button onClick={() => handleJog('Z', 1)}>Z+</Button>
      <Button onClick={() => handleJog('Z', -1)}>Z-</Button>
    </div>
  );
};

export default JogPanel;