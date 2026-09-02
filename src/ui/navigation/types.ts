import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Target: undefined;
  Shots: undefined;
  Sessions: undefined;
  Camera: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  CameraSetup: { profileId?: string; useTargetSystemPairing?: boolean } | undefined;
  CameraDiagnostics: undefined;
  RemotePhoneConnect: undefined;
  TargetCameraMode: undefined;
  TargetSystemSetup: undefined;
  LiveTarget: undefined;
  NewSession: undefined;
  TargetManager: undefined;
  CaptureDetail: { captureId: string };
  CaptureCompare: { baselineCaptureId?: string; comparisonCaptureId?: string } | undefined;
  CandidateReview: { captureId: string; jobId?: string; newestCandidateId?: string };
  ManualShot: { captureId: string };
  TargetTools: undefined;
  TargetRoi: { captureId?: string } | undefined;
  TargetCalibration: { captureId?: string } | undefined;
  PointOfAim: { captureId?: string } | undefined;
  ZeroingAssistant: undefined;
  TargetPlayback: undefined;
  SessionExport: undefined;
  GroupEditor: { groupId?: string };
};
