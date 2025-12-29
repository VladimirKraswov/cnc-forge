// gui/renderer/src/App.tsx
import React from 'react';
import { Provider } from 'react-redux';
import store from './store';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Container from '@mui/material/Container';
import ConnectionPanel from './components/ConnectionPanel';
import StatusPanel from './components/StatusPanel';
import JogPanel from './components/JogPanel';
import HomePanel from './components/HomePanel';
import GCodePanel from './components/GCodePanel';
import ProbePanel from './components/ProbePanel';

const theme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const App = () => {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Container maxWidth="lg">
          <ConnectionPanel />
          <StatusPanel />
          <JogPanel />
          <HomePanel />
          <GCodePanel />
          <ProbePanel />
        </Container>
      </ThemeProvider>
    </Provider>
  );
};

export default App;