using System.Text.Json;
using System.Text.Json.Serialization;
using CashUp.React.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<BadRequestHandler>();
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(provider =>
{
    var path = Path.Combine(builder.Environment.ContentRootPath, "fixtures", "drawer.json");
    var fixture = JsonSerializer.Deserialize<DrawerFixture>(
        File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))
        ?? throw new InvalidDataException("The drawer fixture is empty.");
    return new CloseoutStore(fixture, provider.GetRequiredService<TimeProvider>());
});
builder.Services.AddSingleton<DemoBehavior>();

var app = builder.Build();
app.UseExceptionHandler();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api/closeout"))
    {
        var behavior = context.RequestServices.GetRequiredService<DemoBehavior>();
        var isMutation = HttpMethods.IsPut(context.Request.Method)
            || HttpMethods.IsPost(context.Request.Method);
        var settings = behavior.Take(isMutation);
        await Task.Delay(settings.DelayMilliseconds, context.RequestAborted);
        if (settings.FailNextMutation)
        {
            await Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Simulated service failure",
                detail: "No change was saved. Retry the operation.").ExecuteAsync(context);
            return;
        }
    }
    await next(context);
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/closeout", (CloseoutStore store) => Results.Ok(store.GetSnapshot()));
app.MapPut("/api/closeout/draft", (SaveDraftRequest request, CloseoutStore store) =>
    ToHttpResult(store.SaveDraft(request)));
app.MapPost("/api/closeout/finalize", (CloseoutStore store) =>
    ToHttpResult(store.FinalizeCloseout()));
app.MapPost("/demo/reset", (CloseoutStore store, DemoBehavior behavior) =>
{
    behavior.Reset();
    return Results.Ok(store.Reset());
});
app.MapPut("/demo/behavior", (DemoBehaviorRequest request, DemoBehavior behavior) =>
{
    if (request.DelayMilliseconds is null or < 0 or > 3000)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["delayMilliseconds"] = ["Supply a delay from 0 through 3000 milliseconds."]
        });
    }
    behavior.Configure(request.DelayMilliseconds.Value, request.FailNextMutation);
    return Results.NoContent();
});

app.Run();

static IResult ToHttpResult(MutationResult result) => result switch
{
    MutationResult.Success success => Results.Ok(success.Snapshot),
    MutationResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
    MutationResult.Conflict conflict => Results.Problem(
        statusCode: StatusCodes.Status409Conflict,
        title: "Closeout already finalized",
        detail: conflict.Detail),
    _ => throw new InvalidOperationException("Unknown closeout result.")
};

public partial class Program;
