import {
  Resolver,
  Args,
  Mutation,
  Query,
  Subscription,
  Int,
  Context,
} from '@nestjs/graphql';
import { MantenimientosService } from './mantenimientos.service';
import { PrograMantenimientoDto } from './dto/create-mantenimiento.dto';
import { UpdateMantenimientoDto } from './dto/update-mantenimiento.dto';
import { UpdateOneMantenimientoDto } from './dto/update-one-mantenimiento.dto';
import { Roles } from '../auth/roles.decorator';
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { GqlJwtAuthGuard } from '../auth/gql-jwt-auth.guard';
import { ExistsCarDto } from 'src/cars/dto/exists-card.dto';
import { CarInfo } from './dto/info-placa-mant.dto';
import {
  MantenimientoInfoDto,
  MantenimientoInfoDto56,
} from './dto/info-mant.dto';
import { MantenimientoResult } from './dto/home-tecnico-subscription.dto';
import { HomeAdminDTO } from './dto/home-admin.dto';
import {
  CalendarAndMantenimientosDTO,
  homeMantDTO,
} from './dto/socket-home.dto';
import { pubSub } from 'src/shared/pubsub';
import { MesRepuestos } from './dto/repuestos.mant-busqueda.dto';
import { CreateRepuestoAjusteDto } from './dto/create-repuesto-ajuste.dto';
import { EstadisticWebDTO } from './dto/estadistic-web.dto';
import { CarsService } from 'src/cars/cars.service';
import { HistorialCarData } from './dto/historial-admin.dto';
import { MantenimientoTableType } from './dto/historial-admin-table.dto';
import { CalendarGrafica } from './dto/calendar-graph.dt';
import { UsersService } from 'src/users/users.service';

@Resolver()
export class MantenimientosResolver {
  constructor(
    private readonly mantenimientosService: MantenimientosService,
    private readonly carService: CarsService,
    private readonly usersService: UsersService,
  ) {}

  @Subscription(() => CalendarAndMantenimientosDTO, {
    name: 'Calendar_Hoy_Tecnico',
    description:
      'Esta funcion retorna el calendario de mantenimientos programados del mes, y ademas los mantenimientos para el dia de los ultimos 7 días',
    nullable: true,
    resolve: (payload) => payload.calendarTecnico,
  })
  calendarTecnico() {
    return pubSub.asyncIterator('calendarTecnico');
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Query(() => CalendarAndMantenimientosDTO, {
    name: 'Query_Calendar_Hoy_Tecnico',
    description:
      'Esta funcion retorna el calendario de mantenimientos programados del mes, y ademas los mantenimientos para el dia de hoy',
    nullable: true,
  })
  async QuerycalendarTecnico() {
    const calendar =
      await this.mantenimientosService.getProgrammedMaintenanceCount();
    const mantenimientos =
      await this.mantenimientosService.getMantenimientosDeHoy();

    return { calendar, mantenimientos };
  }

  @Subscription(() => [homeMantDTO], {
    name: 'Actividades',
    description:
      'Esta funcion retorna los mantenimientos desde el día de hoy para la pestaña de actividades',
  })
  actividadesTec() {
    return pubSub.asyncIterator('Actividades');
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Query(() => [homeMantDTO], {
    name: 'Actividades',
    description:
      'Esta funcion retorna los mantenimientos desde el día de hoy para la pestaña de actividades',
  })
  async queryactividadesTec() {
    return await this.mantenimientosService.getMantAPartirDeHoy();
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Query(() => [MesRepuestos], {
    name: 'grafica_repuesto_xmeses',
    description:
      'Esta función retorna los repuestos consumidos en los ultimos x meses, para el reporte de repuestos',
  })
  async getConsumedRepuestos(
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('months', { type: () => Number }) months: number,
  ) {
    const start = new Date(startDate);
    return this.mantenimientosService.getConsumedRepuestos(start, months);
  }
  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Query(() => [Date], {
    name: 'calendar',
    description:
      'Esta función retorna una matriz con las fechas de los mantenimientos que tengan de estado "programado"',
  })
  async getProgrammedMaintenanceDates() {
    return this.mantenimientosService.getProgrammedMaintenanceDates();
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico', 'cliente')
  @Query(() => MantenimientoInfoDto, {
    name: 'Mantenimiento_Info_por_ID',
    description:
      'Esta funcion retorna la informacion de un mantenimiento por id',
  })
  async mantenimiento(@Args('id', { type: () => String }) id: string) {
    return this.mantenimientosService.getMantenimientoPorId(id);
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico', 'cliente')
  @Query(() => [MantenimientoInfoDto56], {
    name: 'Mantenimiento_Info_por_Placa',
    description:
      'Esta funcion retorna la informacion de un mantenimiento por placa',
  })
  async mantenimientoPlaca(
    @Args('placa', { type: () => String }) placa: string,
  ) {
    return this.mantenimientosService.getMantenimientosPorPlaca(placa);
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Query(() => HomeAdminDTO, {
    name: 'home_admin',
    description:
      'Esta funcion se usa en el home del admin y retorna la cantidad de mantenimientos programados, la cantidad total de mantenimientos y los mantenimientos programados',
  })
  async homeAdmin(@Args('fecha') fecha: Date): Promise<HomeAdminDTO> {
    const cantidadProgramada =
      await this.mantenimientosService.getCantidadMantenimientosPorEstadoYFecha(
        'programado',
        fecha,
      );
    const cantidadPendiente =
      await this.mantenimientosService.getCantidadMantenimientosPorEstadoYFecha(
        'pendiente',
        fecha,
      );
    const cantidadRevision =
      await this.mantenimientosService.getCantidadMantenimientosPorEstadoYFecha(
        'revision',
        fecha,
      );
    const cantidadAprobados =
      await this.mantenimientosService.getCantidadMantenimientosPorEstadoYFecha(
        'aprobado',
        fecha,
      );
    const cantidadCompletada =
      await this.mantenimientosService.getCantidadMantenimientosPorEstadoYFecha(
        'completado',
        fecha,
      );

    const cantidadTotal =
      cantidadProgramada +
      cantidadPendiente +
      cantidadRevision +
      cantidadAprobados +
      cantidadCompletada;

    const mantenimientos1 =
      await this.mantenimientosService.getMantenimientosPorEstadoYFecha(
        'programado',
        fecha,
      );
    const mantenimientos2 =
      await this.mantenimientosService.getMantenimientosPorEstadoYFecha(
        'pendiente',
        fecha,
      );
    const mantenimientos3 =
      await this.mantenimientosService.getMantenimientosPorEstadoYFecha(
        'revision',
        fecha,
      );
    const mantenimientos4 =
      await this.mantenimientosService.getMantenimientosPorEstadoYFecha(
        'completado',
        fecha,
      );
    const mantenimientos5 =
      await this.mantenimientosService.getMantenimientosPorEstadoYFecha(
        'aprobado',
        fecha,
      );
    const mantenimientos6 =
      await this.mantenimientosService.getMantenimientosPorEstadoYFecha(
        'expirado',
        fecha,
      );

    const mantenimientos = [
      ...mantenimientos1,
      ...mantenimientos2,
      ...mantenimientos3,
      ...mantenimientos4,
      ...mantenimientos5,
      ...mantenimientos6,
    ];

    return {
      cantidadCompletada,
      cantidadRevision,
      cantidadTotal,
      mantenimientos,
    };
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico', 'cliente')
  @Query(() => CarInfo, {
    name: 'admin_history_cars',
    description:
      'Esta Función retorna la información de un auto ademas de sus mantenimientos (id, fecha, tipo, repuestosUsados) por medio de su placa',
  })
  async findInfoForPlaca(
    @Args('placa', { type: () => String }) placa: string,
  ): Promise<CarInfo> {
    const existsCarDto: ExistsCarDto = { placa };
    return this.mantenimientosService.findInfoForPlaca(existsCarDto);
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Query(() => MantenimientoResult, {
    description:
      'Esta funcion retorna la cantidad de mantenimientos por estado y los mantenimientos (información compleja) por estado y fecha',
  })
  async mantenimientoChanges(
    @Args('estado') estado: string,
    @Args('fecha') fecha: Date,
  ) {
    const cantidad =
      await this.mantenimientosService.getCantidadMantenimientosPorEstado(
        estado,
      );
    const mantenimientos =
      await this.mantenimientosService.getMantenimientosPorEstadoYFecha(
        estado,
        fecha,
      );
    return { cantidad, mantenimientos };
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Mutation(() => Boolean, {
    name: 'cambiar_estado_revision_o_denegado',
    description:
      'Esta función cambia el estado de un mantenimiento a "revision" y realiza una corrección de repuestos, esta corrección es quitar los repuestos que estaban reservados',
  })
  async revision(
    @Args('denegado', { type: () => Boolean }) denegado: boolean,
    @Args('revision', { type: () => Boolean }) revision: boolean,
    @Args('id', { type: () => String }) id: string,
    @Args('repuestosAjuste', { type: () => [CreateRepuestoAjusteDto] })
    repuestosAjuste: CreateRepuestoAjusteDto[],
    @Args('cambiosSolicitados', { type: () => String, nullable: true })
    cambiosSolicitados?: string,
  ) {
    if (denegado) {
      await this.mantenimientosService.deny(id, cambiosSolicitados);
      return true;
    } else {
      if (revision) {
        await this.mantenimientosService.revision(id, cambiosSolicitados);
        return true;
      } else {
        await this.mantenimientosService.Aprobado(id);
        await this.mantenimientosService.addRepuestosAjuste(
          id,
          repuestosAjuste,
        );
        return true;
      }
    }
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Mutation(() => String, {
    name: 'programar_mantenimiento',
    description: 'Esta funcion programa un mantenimiento',
  })
  async programarMant(
    @Args('programarMantInput') prograMantDto: PrograMantenimientoDto,
  ) {
    return await this.mantenimientosService.programar(prograMantDto);
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Mutation(() => String, {
    name: 'regisrar_mantenimiento_no_programado',
    description:
      'Esta funcion registra un mantenimiento que no haya sido previamente programado, ademas en el apartado de repuestos, solo pide entregar una id y la cantidad',
  })
  async updateOneMantenimiento(
    @Args('updateOneMantenimientoInput')
    updateOneMantenimientoDto: UpdateOneMantenimientoDto,
  ) {
    this.mantenimientosService.checkUniqueRepuesto(
      updateOneMantenimientoDto.repuestos,
    );
    return await this.mantenimientosService.registrarNuevo(
      updateOneMantenimientoDto,
    );
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Mutation(() => String, {
    name: 'regisrar_mantenimiento_programado',
    description:
      'Esta Función registra un mantenimiento que ya haya sido previamente programado, ademas en el apartado de repuestos, pide entregar una id y la cantidad',
  })
  async registrarMant(
    @Args('registrarMantInput') registrarMantDto: UpdateMantenimientoDto,
  ) {
    this.mantenimientosService.checkUniqueRepuesto(registrarMantDto.repuestos);
    return await this.mantenimientosService.registrar(registrarMantDto);
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'tecnico')
  @Mutation(() => String, {
    name: 'completar_mantenimiento',
    description:
      'Esta función actualiza el campo diagnosticoFinal de un mantenimiento y cambia su estado a "completado"',
  })
  async actualizarDiagnosticoFinal(
    @Args('id', { type: () => String }) id: string,
    @Args('diagnosticoFinal', { type: () => String }) diagnosticoFinal: string,
    @Args('fechaFin', { type: () => Date }) fechaFin: Date,
  ): Promise<string> {
    return await this.mantenimientosService.completarMantenimiento(
      id,
      diagnosticoFinal,
      fechaFin,
    );
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Query(() => EstadisticWebDTO, {
    name: 'estadisticas_web',
    description:
      'Esta función retorna: 1. el kilometraje recorrido por mes de un vehiculo, la matriz de salida tendra un formato de [mes, kmRecorridoTotal] donde mes es "MM/YYYY" y kmRecorridoTotal es un numero, 2. los costos de mantenimiento por mes, la matriz de salida tendra un formato de [mes, costoTotal] donde mes es "MM/YYYY" y costoTotal es un numero, 3. el puntaje de un vehiculo, 4. la cantidad de mantenimientos realizados por mes, 5. la cantidad de mantenimientos denegados por mes, 6. los repuestos mas consumidos por mes, la matriz de salida tendra un formato de [mes, repuesto1, repuesto2, repuesto3, repuesto4, otros] donde mes es "MM/YYYY" y repuesto1, repuesto2, repuesto3, repuesto4, otros son objetos con la estructura de RepuestoConsumido',
  })
  async getKmRecorridoPorMes(
    @Args('placa') placa: string,
    @Args('fecha') fecha: string,
  ): Promise<EstadisticWebDTO> {
    try {
      const placaSelect = await this.carService.findFirstByPlaca(placa);
      // Si la fecha es una cadena vacía, asigna la fecha actual
      const fechaSeleccionada = fecha === '' ? new Date() : new Date(fecha);

      const kmRecorrido = await this.mantenimientosService.getKmRecorridoPorMes(
        placaSelect.placa,
        new Date(fechaSeleccionada),
      );

      const costos = await this.mantenimientosService.getCostos(
        placaSelect.placa,
        new Date(fechaSeleccionada),
      );

      const puntaje = await this.carService.getPuntaje(placaSelect.placa);
      const cantidadMatenimientos =
        await this.mantenimientosService.getNumeroMantenimientos(
          placaSelect.placa,
          new Date(fechaSeleccionada),
        );

      const cantidadMatDenegados =
        await this.mantenimientosService.getNumeroMantCance(
          placaSelect.placa,
          new Date(fechaSeleccionada),
        );

      const repuestosConsumidos =
        await this.mantenimientosService.getRepuestosMasConsumidos(
          placaSelect.placa,
          new Date(fechaSeleccionada),
        );

      const operatividad =
        await this.mantenimientosService.getOperatividadPorMes(
          placaSelect.placa,
          new Date(fechaSeleccionada),
        );
      return {
        placa: placaSelect.placa,
        cliente: placaSelect.cliente,
        kmRecorrido: kmRecorrido,
        costos: costos,
        puntaje: puntaje,
        cantidadMatenimientos: cantidadMatenimientos,
        cantidadMatDenegados: cantidadMatDenegados,
        repuestosConsumidos: repuestosConsumidos,
        operatividad: operatividad,
      };
    } catch {
      return {
        kmRecorrido: [],
        placa: null,
        cliente: null,
        costos: {
          costoTotal: null,
          costoPreventivos: null,
          costoCorrectivos: null,
          costoMesPasado: null,
        },
        puntaje: null,
        cantidadMatenimientos: null,
        cantidadMatDenegados: null,
        repuestosConsumidos: null,
        operatividad: [],
      };
    }
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'cliente')
  @Query(() => HistorialCarData, {
    name: 'Historial_Car_Admin',
    description:
      'Esta función retorna la información de un auto incluyendo su operatividad porcentual por medio de su placa',
  })
  async getCarData(
    @Args('searchParam', { type: () => String, nullable: true })
    searchParam: string,
    @Context() context,
  ): Promise<HistorialCarData> {
    const username = context.req.user.username;
    const cliente = await this.usersService.findClientByUsername(username);
    try {
      return this.mantenimientosService.getCarData(searchParam, cliente);
    } catch {
      return null;
    }
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin', 'cliente')
  @Query(() => MantenimientoTableType, {
    name: 'table_historial_Mantenimientos_admin',
    description:
      'Esta función retorna los mantenimientos que cumplan con los criterios de busqueda',
  })
  async searchMantenimientos(
    @Args('fechaInicio', { type: () => Date, nullable: true })
    fechaInicio: Date,
    @Args('fechaTermino', { type: () => Date, nullable: true })
    fechaTermino: Date,
    @Args('placa', { type: () => String, nullable: true }) placa: string,
    @Args('page', { type: () => Int, nullable: true }) page: number,
    @Context() context,
  ): Promise<MantenimientoTableType> {
    const username = context.req.user.username;
    const cliente = await this.usersService.findClientByUsername(username);
    try {
      return this.mantenimientosService.searchMantenimientos(
        cliente,
        fechaInicio,
        fechaTermino,
        placa,
        page,
      );
    } catch {
      return null;
    }
  }

  @UseGuards(GqlJwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Query(() => [CalendarGrafica], {
    name: 'calendar_grafica',
    description:
      'Esta función retorna la cantidad de mantenimientos programados',
  })
  async getCalendarGrafica() {
    const fechaActual = new Date();
    return this.mantenimientosService.getCalendarGraficaRange(fechaActual);
  }
}
