// gui/renderer/src/components/StatusPanel.tsx
import React from 'react';
import { useSelector } from 'react-redux';
import Typography from '@mui/material/Typography';

const StatusPanel = () => {
  const status = useSelector((state) => state.machine.status);

  return (
    <div>
      <Typography variant="h6">Status: {status.state}</Typography>
      <Typography>Position: X{status.position.x} Y{status.position.y} Z{status.position.z}</Typography>
      <Typography>Feed: {status.feed}</Typography>
    </div>
  );
};

export default StatusPanel;