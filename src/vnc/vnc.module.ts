import { Module } from '@nestjs/common';
import { openRfb2Session } from './rfb2-session';
import { RFB_SESSION_OPENER, VncConnector } from './vnc-connector';

@Module({
  providers: [
    { provide: RFB_SESSION_OPENER, useValue: openRfb2Session },
    VncConnector,
  ],
  exports: [VncConnector],
})
export class VncModule {}
