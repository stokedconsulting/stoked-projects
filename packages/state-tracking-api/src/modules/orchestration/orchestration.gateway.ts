import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AppLoggerService } from '../../common/logging/app-logger.service';
import {
  WorkspaceOrchestration,
  GlobalOrchestration,
} from './orchestration.service';

interface ClientData {
  workspaceId?: string;
  connectedAt: Date;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Configure based on your needs
    credentials: true,
  },
  path: '/orchestration',
  transports: ['websocket', 'polling'],
})
export class OrchestrationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private clients: Map<string, ClientData> = new Map();

  constructor(private logger: AppLoggerService) {
    this.logger.setContext('OrchestrationGateway');
  }

  handleConnection(client: Socket) {
    this.clients.set(client.id, {
      connectedAt: new Date(),
    });

    this.logger.log('WebSocket client connected', {
      client_id: client.id,
      event: 'websocket.connected',
    });
  }

  handleDisconnect(client: Socket) {
    const data = this.clients.get(client.id);
    this.clients.delete(client.id);

    this.logger.log('WebSocket client disconnected', {
      client_id: client.id,
      workspace_id: data?.workspaceId,
      event: 'websocket.disconnected',
    });
  }

  /**
   * Subscribe to workspace updates
   * Client sends: { workspaceId: string }
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { workspaceId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { workspaceId } = data;

    if (!workspaceId) {
      client.emit('error', { message: 'workspaceId is required' });
      return;
    }

    // Update client data
    const clientData = this.clients.get(client.id);
    if (clientData) {
      clientData.workspaceId = workspaceId;
    }

    // Join workspace room
    client.join(`workspace:${workspaceId}`);

    this.logger.log('Client subscribed to workspace', {
      client_id: client.id,
      workspace_id: workspaceId,
      event: 'orchestration.subscribe',
    });

    client.emit('subscribed', { workspaceId });
  }

  /**
   * Unsubscribe from workspace updates
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() data: { workspaceId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { workspaceId } = data;

    if (!workspaceId) {
      return;
    }

    // Leave workspace room
    client.leave(`workspace:${workspaceId}`);

    // Update client data
    const clientData = this.clients.get(client.id);
    if (clientData && clientData.workspaceId === workspaceId) {
      clientData.workspaceId = undefined;
    }

    this.logger.log('Client unsubscribed from workspace', {
      client_id: client.id,
      workspace_id: workspaceId,
      event: 'orchestration.unsubscribe',
    });

    client.emit('unsubscribed', { workspaceId });
  }

  /**
   * Broadcast global orchestration update to all connected clients
   */
  broadcastGlobalUpdate(global: GlobalOrchestration) {
    this.server.emit('orchestration.global', global);

    this.logger.debug('Broadcasted global orchestration update', {
      running: global.running,
      desired: global.desired,
      event: 'orchestration.global.broadcast',
    });
  }

  /**
   * Broadcast workspace orchestration update to subscribed clients
   */
  broadcastWorkspaceUpdate(
    workspaceId: string,
    workspace: WorkspaceOrchestration,
  ) {
    this.server.to(`workspace:${workspaceId}`).emit('orchestration.workspace', {
      workspaceId,
      ...workspace,
    });

    this.logger.debug('Broadcasted workspace orchestration update', {
      workspace_id: workspaceId,
      running: workspace.running,
      desired: workspace.desired,
      event: 'orchestration.workspace.broadcast',
    });
  }

  /**
   * Get connected clients count
   */
  getConnectedClientsCount(): number {
    return this.clients.size;
  }

  /**
   * Get clients subscribed to a workspace
   */
  getWorkspaceClientsCount(workspaceId: string): number {
    return this.server.sockets.adapter.rooms.get(`workspace:${workspaceId}`)
      ?.size || 0;
  }
}
