import React, {type ReactNode} from 'react';
import Desktop from '@theme-original/DocItem/TOC/Desktop';
import type DesktopType from '@theme/DocItem/TOC/Desktop';
import type {WrapperProps} from '@docusaurus/types';
import {AdUnit} from '@site/src/components/AdUnit';

type Props = WrapperProps<typeof DesktopType>;

export default function DesktopWrapper(props: Props): ReactNode {
  return (
    <>
      <Desktop {...props} />
      <div style={{marginTop: '1.5rem', position: 'sticky', top: 'calc(var(--ifm-navbar-height) + 6rem)'}}>
        <AdUnit
          adSlot="1554655866"
          adFormat="vertical"
          fullWidthResponsive={false}
          style={{minHeight: '250px'}}
        />
      </div>
    </>
  );
}
