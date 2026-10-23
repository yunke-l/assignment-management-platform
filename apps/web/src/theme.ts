import {
  Button,
  Checkbox,
  createTheme,
  Modal,
  Radio,
  rem,
  Select,
  Textarea,
  TextInput,
} from '@mantine/core';
import classes from './theme.module.css';

export const theme = createTheme({
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  headings: { fontFamily: "'Avenir Next', 'Trebuchet MS', system-ui, sans-serif" },
  fontSizes: { xs: rem(14), sm: rem(14), md: rem(16), lg: rem(18), xl: rem(20) },
  lineHeights: { md: '1.5' },
  primaryColor: 'forest',
  primaryShade: 7,
  colors: {
    forest: [
      '#f2f7f4',
      '#e5efe9',
      '#cbdfd2',
      '#a6c6b3',
      '#7aa98e',
      '#568c70',
      '#367d66',
      '#245747',
      '#1d4c3d',
      '#163d31',
    ],
  },
  defaultRadius: rem(9),
  respectReducedMotion: true,
  components: {
    Button: Button.extend({
      defaultProps: { size: 'md' },
      classNames: { root: classes.button, inner: classes.buttonInner, label: classes.buttonLabel },
    }),
    TextInput: TextInput.extend({
      defaultProps: { size: 'md', withAsterisk: false },
      classNames: { root: classes.field, label: classes.label, input: classes.input },
    }),
    Textarea: Textarea.extend({
      defaultProps: { size: 'md', withAsterisk: false },
      classNames: { root: classes.inlineField, input: classes.input },
    }),
    Select: Select.extend({
      defaultProps: { size: 'md', withAsterisk: false },
      classNames: {
        root: classes.inlineField,
        input: classes.selectInput,
        dropdown: classes.selectDropdown,
        option: classes.selectOption,
      },
    }),
    Checkbox: Checkbox.extend({ defaultProps: { size: 'sm', radius: 'sm' } }),
    Radio: Radio.extend({ defaultProps: { size: 'sm' } }),
    Modal: Modal.extend({
      classNames: {
        content: classes.modalContent,
        header: classes.modalHeader,
        title: classes.modalTitle,
        body: classes.modalBody,
      },
    }),
  },
});
