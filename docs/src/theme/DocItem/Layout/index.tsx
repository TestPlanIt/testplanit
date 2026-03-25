import React, {type ReactNode} from 'react';
import Layout from '@theme-original/DocItem/Layout';
import type LayoutType from '@theme/DocItem/Layout';
import type {WrapperProps} from '@docusaurus/types';
import {AdUnit} from '@site/src/components/AdUnit';

type Props = WrapperProps<typeof LayoutType>;

export default function LayoutWrapper(props: Props): ReactNode {
  return (
    <>
      <Layout {...props} />
      <div style={{marginTop: '2rem', marginBottom: '1rem'}}>
        <AdUnit
          adSlot="4180819205"
          adFormat="horizontal"
          fullWidthResponsive={true}
          style={{minHeight: '90px'}}
        />
      </div>
    </>
  );
}
