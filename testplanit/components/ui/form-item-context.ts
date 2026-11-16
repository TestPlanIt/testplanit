import * as React from "react";

type FormItemContextValue = {
  id: string;
};

/**
 * The id a form item hands its label and control. It lives apart from the
 * form components so a control such as the select trigger can read it without
 * importing the form.
 */
export const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue
);
