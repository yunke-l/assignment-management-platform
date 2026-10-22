// Include dependency styles before the components that use them.
import '@mantine/core/styles/baseline.css';
import '@mantine/core/styles/default-css-variables.css';
import '@mantine/core/styles/global.css';
import '@mantine/core/styles/UnstyledButton.css';
import '@mantine/core/styles/VisuallyHidden.css';
import '@mantine/core/styles/Loader.css';
import '@mantine/core/styles/Button.css';
import '@mantine/core/styles/CloseButton.css';
import '@mantine/core/styles/Paper.css';
import '@mantine/core/styles/Overlay.css';
import '@mantine/core/styles/ModalBase.css';
import '@mantine/core/styles/Modal.css';
import '@mantine/core/styles/Input.css';
import '@mantine/core/styles/Alert.css';
import '@mantine/core/styles/Combobox.css';
import '@mantine/core/styles/Popover.css';
import '@mantine/core/styles/Checkbox.css';
import '@mantine/core/styles/Radio.css';
import '@mantine/core/styles/InlineInput.css';
import '@mantine/core/styles/Progress.css';
import '@mantine/core/styles/Slider.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import { ConfirmProvider } from './ConfirmDialog';
import { theme } from './theme';
const router = createBrowserRouter([{ path: '*', element: <App /> }]);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      forceColorScheme="light"
      cssVariablesResolver={() => ({
        variables: {},
        light: { '--mantine-color-body': '#f6f8f7', '--mantine-color-text': '#243a33' },
        dark: {},
      })}
    >
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </MantineProvider>
  </StrictMode>,
);
